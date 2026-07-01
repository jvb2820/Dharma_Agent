const HUBSPOT_API_BASE_URL = 'https://api.hubapi.com'
const EASTERN_TIMEZONE = 'America/New_York'
const DEFAULT_DEAL_PIPELINE = '693198644'
const DEFAULT_DEAL_STAGE = '1013987700'
const DEFAULT_DEAL_EVALUATION_DATE_PROPERTY = 'evaluation_date_and_hour_2'
const DEFAULT_DEAL_NAME_PREFIX = 'Sellers'
const DEFAULT_DISABLED_SELLER_SLUGS = ['diana-giron']

const PRIORITY_SELLERS = [
  { slug: 'meribet-yazziet', name: 'Meribet', fieldValue: 'Meribet Sampson' },
  { slug: 'lgoncalves2', name: 'Leo', fieldValue: 'Leonardo Goncales' },
  { slug: 'mclaudia', name: 'Maria Claudia', fieldValue: 'Maria Claudia' },
  { slug: 'acastro29', name: 'Andres', fieldValue: 'Andres Castro' },
  { slug: 'alejandro667', name: 'Alejandro', fieldValue: 'Alejandro Rivera' },
  { slug: 'diana-giron', name: 'Diana', fieldValue: 'Diana Stephanie' },
]

const CUSTOMER_SERVICE_TEAM = [
  { slug: 'alice-f', name: 'Alice', fieldValue: 'Alice F' },
  { slug: 'brayam-zuluaga', name: 'Brayam', fieldValue: 'Brayam Zuluaga' },
  { slug: 'arles-martinez', name: 'Arles', fieldValue: 'Arles Martinez' },
  { slug: 'edmilson-morales', name: 'Edmilson', fieldValue: 'Edmilson Morales' },
]

export async function getPrioritySellerAvailability({
  limit = 6,
  preferredTime = '',
  preferredSpecialist = '',
} = {}) {
  return getTeamAvailability({
    members: filterSellersByPreference(getConfiguredPrioritySellers(), preferredSpecialist),
    limit,
    preferredTime,
  })
}

export async function getCustomerServiceAvailability({
  limit = 6,
  preferredTime = '',
  preferredSpecialist = '',
} = {}) {
  return getTeamAvailability({
    members: filterSellersByPreference(getConfiguredCustomerServiceTeam(), preferredSpecialist),
    limit,
    preferredTime,
  })
}

async function getTeamAvailability({ members, limit = 6, preferredTime = '' }) {
  const timezone = EASTERN_TIMEZONE
  const options = []
  const preference = parsePreferredTime(preferredTime, timezone)
  const weekday = parsePreferredWeekday(preferredTime)
  const monthOffset = getMonthOffsetForPreference(preference, timezone)

  for (const [sellerIndex, seller] of members.entries()) {
    const meetingInfo = await fetchMeetingInfo({ slug: seller.slug, timezone }).catch((error) => {
      console.warn(`Unable to fetch HubSpot meeting info for ${seller.name}: ${error.message}`)
      return null
    })

    if (!meetingInfo) {
      continue
    }

    const supportedFormFieldNames = getSupportedFormFieldNames(meetingInfo)
    const duration = meetingInfo.customParams?.durations?.[0] || 1200000

    if (duration !== 1200000 && duration !== 1800000) {
      continue
    }

    const availability = await fetchAvailability({ slug: seller.slug, timezone, monthOffset }).catch((error) => {
      console.warn(`Unable to fetch HubSpot availability for ${seller.name}: ${error.message}`)
      return null
    })

    if (!availability) {
      continue
    }

    const slots = availability.linkAvailability?.linkAvailabilityByDuration?.[duration]?.availabilities || []

    const futureSlots = slots.filter((slot) => slot.startMillisUtc > Date.now() + 5 * 60 * 1000)
    const candidateSlots = futureSlots.filter((slot) => {
      if (weekday === null) {
        return true
      }
      const slotDate = new Date(slot.startMillisUtc)
      const slotWeekdayStr = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        timeZone: timezone,
      }).format(slotDate).toLowerCase()

      const weekdaysEnglish = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      return weekdaysEnglish.indexOf(slotWeekdayStr) === weekday
    })
    const maxSlotsPerSeller = preference.dateKey || preference.hour != null || weekday !== null ? 100 : 6

    for (const slot of candidateSlots.slice(0, maxSlotsPerSeller)) {
      options.push({
        sellerName: seller.name,
        sellerSlug: seller.slug,
        sellerFieldValue: seller.fieldValue,
        supportedFormFieldNames,
        startTime: slot.startMillisUtc,
        endTime: slot.endMillisUtc,
        duration,
        timezone,
        sellerPriority: sellerIndex,
        display: formatSpecialistSlot({
          specialistName: seller.name,
          timestamp: slot.startMillisUtc,
          timezone,
        }),
      })
    }
  }

  const sortedOptions = options.sort((left, right) =>
    compareAvailabilityOptions(left, right, preference, timezone),
  )

  return sortedOptions
    .slice(0, limit)
    .map((option, index) => ({
      ...option,
      id: String(index + 1),
    }))
}

function compareAvailabilityOptions(left, right, preference, timezone) {
  if (preference.dateKey) {
    const leftDateScore = getDateDistance(left.startTime, preference.dateKey, timezone)
    const rightDateScore = getDateDistance(right.startTime, preference.dateKey, timezone)

    if (leftDateScore !== rightDateScore) {
      return leftDateScore - rightDateScore
    }
  }

  if (preference.hour != null) {
    const leftScore = getTimeDistance(left.startTime, preference, timezone)
    const rightScore = getTimeDistance(right.startTime, preference, timezone)

    if (leftScore !== rightScore) {
      return leftScore - rightScore
    }
  }

  if (left.startTime !== right.startTime) {
    return left.startTime - right.startTime
  }

  return left.sellerPriority - right.sellerPriority
}

function getMonthOffsetForPreference(preference, timezone) {
  if (!preference.dateKey) {
    return 0
  }

  const current = getDateParts(Date.now(), timezone)
  const [targetYear, targetMonth] = preference.dateKey.split('-').map(Number)

  if (!targetYear || !targetMonth) {
    return 0
  }

  return Math.max(0, (targetYear - current.year) * 12 + (targetMonth - current.month))
}

function parsePreferredTime(value, timezone) {
  const normalized = String(value || '').toLowerCase()
  const preference = {
    dateKey: parsePreferredDateKey(normalized, timezone),
  }
  const timeText = normalized
    .replace(
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/i,
      '',
    )
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/, '')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/i, '')
  const hourMatch = timeText.match(/\b(1[0-2]|0?[1-9])(?::\d{2})?\s*(am|pm)?\b/)

  if (!hourMatch) {
    return preference
  }

  let hour = Number(hourMatch[1])
  const period = hourMatch[2]
  const minuteMatch = hourMatch[0].match(/:(\d{2})/)
  const minute = minuteMatch ? Number(minuteMatch[1]) : 0

  if (period === 'pm' && hour < 12) {
    hour += 12
  }

  if (period === 'am' && hour === 12) {
    hour = 0
  }

  return { ...preference, hour, minute }
}

function parsePreferredDateKey(value, timezone) {
  const monthMatch = value.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  )

  if (monthMatch) {
    return buildDateKeyFromMonthDay(monthMatch[1], Number(monthMatch[2]), timezone)
  }

  const numericDateMatch = value.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b/)

  if (numericDateMatch) {
    return buildDateKey(Number(numericDateMatch[1]), Number(numericDateMatch[2]), timezone)
  }

  const ordinalDayMatch = value.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/)

  if (ordinalDayMatch) {
    return buildDateKeyForDayOfMonth(Number(ordinalDayMatch[1]), timezone)
  }

  return ''
}

function buildDateKeyFromMonthDay(monthName, day, timezone) {
  const monthIndex = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ].findIndex((month) => monthName.toLowerCase().startsWith(month))

  if (monthIndex === -1) {
    return ''
  }

  const current = getDateParts(Date.now(), timezone)
  const currentKey = `${current.year}-${pad2(current.month)}-${pad2(current.day)}`
  let dateKey = buildDateKey(monthIndex + 1, day, timezone, current.year)

  if (dateKey && dateKey < currentKey) {
    dateKey = buildDateKey(monthIndex + 1, day, timezone, current.year + 1)
  }

  return dateKey
}

function buildDateKeyForDayOfMonth(day, timezone) {
  const current = getDateParts(Date.now(), timezone)
  let month = current.month
  let year = current.year

  if (day < current.day) {
    month += 1

    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return buildDateKey(month, day, timezone, year)
}

function buildDateKey(month, day, timezone, year = getDateParts(Date.now(), timezone).year) {
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
    return ''
  }

  return `${year}-${pad2(month)}-${pad2(day)}`
}

function getDateKey(timestamp, timezone) {
  const parts = getDateParts(timestamp, timezone)

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

function getDateDistance(timestamp, targetDateKey, timezone) {
  return Math.abs(dateKeyToNumber(getDateKey(timestamp, timezone)) - dateKeyToNumber(targetDateKey))
}

function dateKeyToNumber(dateKey) {
  return Number(String(dateKey).replace(/\D/g, '')) || 0
}

function getDateParts(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(new Date(timestamp))

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value || 0),
    month: Number(parts.find((part) => part.type === 'month')?.value || 0),
    day: Number(parts.find((part) => part.type === 'day')?.value || 0),
  }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function getTimeDistance(timestamp, preference, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(new Date(timestamp))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0)
  const preferredMinute = preference.minute || 0

  return Math.abs(hour * 60 + minute - (preference.hour * 60 + preferredMinute))
}

export async function bookPrioritySellerMeeting({ customer, option }) {
  return bookTeamMeeting({
    customer,
    option,
    members: getConfiguredPrioritySellers(),
    teamLabel: 'priority seller',
  })
}

export async function bookCustomerServiceMeeting({ customer, option }) {
  return bookTeamMeeting({
    customer,
    option,
    members: getConfiguredCustomerServiceTeam(),
    teamLabel: 'customer service team',
  })
}

async function bookTeamMeeting({ customer, option, members, teamLabel }) {
  const timezone = EASTERN_TIMEZONE
  const token = requireHubSpotToken()
  const seller = members.find((item) => item.slug === option?.sellerSlug)

  if (!seller) {
    throw new Error(`Selected specialist is not in the ${teamLabel} list.`)
  }

  const supportedFormFieldNames = option.supportedFormFieldNames?.length
    ? option.supportedFormFieldNames
    : getSupportedFormFieldNames(await fetchMeetingInfo({ slug: seller.slug, timezone }))

  let contact = await upsertBookingContactProperties(customer)

  const payload = {
    slug: seller.slug,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    startTime: option.startTime,
    duration: option.duration,
    timezone,
    locale: resolveLocale(customer.preferredLanguage),
    guestEmails: [],
    likelyAvailableUserIds: [],
    formFields: buildBookingFormFields({
      customer,
      seller,
      supportedFormFieldNames,
    }),
  }

  const response = await fetch(
    `${HUBSPOT_API_BASE_URL}/scheduler/v3/meetings/meeting-links/book?timezone=${encodeURIComponent(timezone)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || `HubSpot booking failed with ${response.status}.`)
  }

  if (data.isOffline) {
    throw new Error(
      'HubSpot accepted this as an offline booking request, but no calendar event was created. Please check that this specialist has a connected calendar in HubSpot.',
    )
  }

  if (!data.calendarEventId) {
    throw new Error('HubSpot did not return a calendar event ID, so the appointment was not confirmed.')
  }

  contact = await upsertBookingContactProperties(customer).catch((error) => {
    console.warn(`Unable to update booked contact details: ${error.message}`)
    return contact
  })

  const dealSync = await syncBookedMeetingDeal({
    customer,
    option,
    seller,
    contact,
  }).catch((error) => {
    console.warn(`Unable to sync booked meeting deal: ${error.message}`)
    return {
      ok: false,
      error: error.message,
    }
  })

  return {
    ...data,
    dealSync,
    sellerName: seller.name,
    display: formatSpecialistSlot({
      specialistName: seller.name,
      timestamp: option.startTime,
      timezone,
    }),
  }
}

function buildBookingFormFields({ customer, seller, supportedFormFieldNames = [] }) {
  const supportedNames = new Set(supportedFormFieldNames)

  return [
    { name: 'create_deal', value: 'true' },
    { name: 'agent_lead_management', value: seller.fieldValue },
    { name: 'dont_send_notification', value: 'false' },
    { name: 'desired_treatment', value: customer.desiredTreatment },
    { name: 'desired_treatment_form', value: customer.desiredTreatment },
  ].filter((field) => field.value && supportedNames.has(field.name))
}

async function syncBookedMeetingDeal({ customer, option, seller, contact }) {
  const contactRecord = contact?.id ? contact : await findHubSpotContactByEmail(customer.email)

  if (!contactRecord?.id) {
    throw new Error('HubSpot contact was not found after booking.')
  }

  const meeting = await findBookedMeetingForContact({
    contactId: contactRecord.id,
    startTime: option.startTime,
  })
  const existingDeal = await findReusableDealForContact(contactRecord.id)
  const properties = buildBookingDealProperties({
    customer,
    seller,
    option,
    meeting,
  })
  const deal = existingDeal?.id
    ? await updateDealProperties(existingDeal.id, properties)
    : await createDealProperties(properties)

  await associateHubSpotObjects('deals', deal.id, 'contacts', contactRecord.id)

  if (meeting?.id) {
    await associateHubSpotObjects('deals', deal.id, 'meetings', meeting.id)
  }

  return {
    ok: true,
    dealId: deal.id,
    meetingId: meeting?.id || null,
    reused: Boolean(existingDeal?.id),
  }
}

function buildBookingDealProperties({ customer, seller, option, meeting }) {
  const fullName = formatCustomerName(customer)
  const treatment = normalizeDesiredTreatment(customer.desiredTreatment)
  const properties = {
    dealname: `${getDealNamePrefix()} - ${fullName}`,
    pipeline: getDealPipeline(),
    dealstage: getDealStage(),
    [getDealEvaluationDateProperty()]: String(option.startTime),
    agent_lead_management: seller.fieldValue,
    desired_treatment: treatment,
  }

  if (meeting?.properties?.hubspot_owner_id) {
    properties.hubspot_owner_id = meeting.properties.hubspot_owner_id
  }

  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => Boolean(value)),
  )
}

function formatCustomerName(customer) {
  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim()

  return fullName || customer.email || customer.phone || 'New Lead'
}

function getDealPipeline() {
  return process.env.HUBSPOT_DEAL_PIPELINE || DEFAULT_DEAL_PIPELINE
}

function getDealStage() {
  return process.env.HUBSPOT_DEAL_STAGE || DEFAULT_DEAL_STAGE
}

function getDealEvaluationDateProperty() {
  return process.env.HUBSPOT_DEAL_EVALUATION_DATE_PROPERTY || DEFAULT_DEAL_EVALUATION_DATE_PROPERTY
}

function getDealNamePrefix() {
  return process.env.HUBSPOT_DEAL_NAME_PREFIX || DEFAULT_DEAL_NAME_PREFIX
}

async function findBookedMeetingForContact({ contactId, startTime }) {
  const associations = await getAssociatedObjectIds('contacts', contactId, 'meetings')

  if (!associations.length) {
    return null
  }

  const meetings = await Promise.all(
    associations.map((meetingId) =>
      fetchHubSpotObject('meetings', meetingId, [
        'hs_meeting_start_time',
        'hs_meeting_title',
        'hs_meeting_outcome',
        'hubspot_owner_id',
      ]).catch(() => null),
    ),
  )
  const targetStart = Number(startTime)

  return meetings
    .filter(Boolean)
    .map((meeting) => ({
      ...meeting,
      startDelta: Math.abs(
        new Date(meeting.properties?.hs_meeting_start_time || 0).getTime() - targetStart,
      ),
    }))
    .sort((left, right) => left.startDelta - right.startDelta)[0]
}

async function findReusableDealForContact(contactId) {
  const dealIds = await getAssociatedObjectIds('contacts', contactId, 'deals')

  if (!dealIds.length) {
    return null
  }

  const deals = await Promise.all(
    dealIds.map((dealId) =>
      fetchHubSpotObject('deals', dealId, ['dealname', 'pipeline', 'dealstage', 'closedate']).catch(
        () => null,
      ),
    ),
  )

  return (
    deals.find(
      (deal) =>
        deal?.properties?.pipeline === getDealPipeline() &&
        deal?.properties?.dealstage === getDealStage(),
    ) || null
  )
}

async function createDealProperties(properties) {
  return hubspotSend('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  })
}

async function updateDealProperties(dealId, properties) {
  return hubspotSend(`/crm/v3/objects/deals/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  })
}

async function associateHubSpotObjects(fromType, fromId, toType, toId) {
  return hubspotSend(
    `/crm/v4/objects/${encodeURIComponent(fromType)}/${encodeURIComponent(
      fromId,
    )}/associations/default/${encodeURIComponent(toType)}/${encodeURIComponent(toId)}`,
    { method: 'PUT' },
  )
}

async function getAssociatedObjectIds(fromType, fromId, toType) {
  const data = await hubspotGet(
    `/crm/v4/objects/${encodeURIComponent(fromType)}/${encodeURIComponent(
      fromId,
    )}/associations/${encodeURIComponent(toType)}?limit=100`,
  )

  return (data.results || [])
    .map((item) => item.toObjectId || item.to?.id || item.id)
    .filter(Boolean)
}

async function fetchHubSpotObject(objectType, objectId, properties = []) {
  const params = properties.length ? `?properties=${properties.map(encodeURIComponent).join(',')}` : ''

  return hubspotGet(
    `/crm/v3/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}${params}`,
  )
}

async function upsertBookingContactProperties(customer) {
  const properties = buildBookingContactProperties(customer)

  if (Object.keys(properties).length === 0) {
    return null
  }

  const contact = await findHubSpotContactByEmail(customer.email)

  if (contact?.id) {
    return updateContactProperties(contact.id, properties)
  }

  return createContactProperties(properties)
}

function buildBookingContactProperties(customer) {
  const properties = {
    firstname: customer.firstName || '',
    lastname: customer.lastName || '',
    email: customer.email || '',
    phone: customer.phone || '',
    desired_treatment: normalizeDesiredTreatment(customer.desiredTreatment),
  }

  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => Boolean(value)),
  )
}

async function updateContactProperties(contactId, properties) {
  const response = await fetch(`${HUBSPOT_API_BASE_URL}/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${requireHubSpotToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties,
    }),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || `HubSpot contact update failed with ${response.status}.`)
  }

  return data
}

async function createContactProperties(properties) {
  const response = await fetch(`${HUBSPOT_API_BASE_URL}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireHubSpotToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || `HubSpot contact create failed with ${response.status}.`)
  }

  return data
}

function normalizeDesiredTreatment(value) {
  const normalized = String(value || '').toLowerCase()
  const searchable = normalizeTreatmentSearchText(value)
  const compact = searchable.replace(/\s+/g, '')

  if (/\b(zep|zepbound)\b/.test(searchable)) {
    return 'Zepbound'
  }

  if (
    /\b(weight loss|lose weight|losing weight|slim down|slimming|fat loss|bajar de peso|perder peso|glp 1|semaglutide|tirzepatide|wegovy|shot|shots|injection|injections|injectable|medication|meds)\b/.test(
      searchable,
    ) ||
    /(weightloss|loseweight|losingweight|fatloss|slimdown|glp1)/.test(compact)
  ) {
    return 'Compounded Semaglutide'
  }

  if (/\b(nutri|nutrition|nutritionist|nutritional|diet|dietitian|meal plan|food plan|consult|consultation|consulta|asesoria nutricional|nutricion)\b/.test(searchable)) {
    return 'Nutrition Consultation'
  }

  if (/\b(supp|supps|supplement|supplements|vitamin|vitamins|protein|collagen|greens|probiotic|suplemento|suplementos)\b/.test(searchable)) {
    return 'Supplements'
  }

  if (/\b(nutri|consult|consultation)\b/i.test(normalized)) {
    return 'Nutrition Consultation'
  }

  if (normalized.includes('zepbound')) {
    return 'Zepbound'
  }

  if (
    normalized.includes('weight loss') ||
    normalized.includes('injection') ||
    normalized.includes('glp') ||
    normalized.includes('semaglutide') ||
    normalized.includes('tirzepatide')
  ) {
    return 'Compounded Semaglutide'
  }

  if (normalized.includes('supplement')) {
    return 'Supplements'
  }

  if (normalized.includes('nutrition')) {
    return 'Nutrition Consultation'
  }

  return ''
}

function normalizeTreatmentSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getSupportedFormFieldNames(meetingInfo) {
  const names = new Set()

  collectFormFieldNames(meetingInfo, names)

  return [...names]
}

function collectFormFieldNames(value, names) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectFormFieldNames(item, names))
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  if (typeof value.name === 'string') {
    names.add(value.name)
  }

  Object.values(value).forEach((item) => collectFormFieldNames(item, names))
}

export async function findHubSpotContactByEmail(email) {
  if (!email) {
    return null
  }

  const token = requireHubSpotToken()
  const response = await fetch(`${HUBSPOT_API_BASE_URL}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'email',
              operator: 'EQ',
              value: email,
            },
          ],
        },
      ],
      properties: ['firstname', 'lastname', 'email', 'phone', 'state'],
      limit: 1,
    }),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || `HubSpot contact lookup failed with ${response.status}.`)
  }

  return data.results?.[0] || null
}

async function fetchMeetingInfo({ slug, timezone }) {
  return hubspotGet(`/scheduler/v3/meetings/meeting-links/book/${encodeURIComponent(slug)}?timezone=${encodeURIComponent(timezone)}`)
}

async function fetchAvailability({ slug, timezone, monthOffset = 0 }) {
  return hubspotGet(
    `/scheduler/v3/meetings/meeting-links/book/availability-page/${encodeURIComponent(slug)}?timezone=${encodeURIComponent(timezone)}&monthOffset=${encodeURIComponent(monthOffset)}`,
  )
}

async function hubspotGet(path) {
  const token = requireHubSpotToken()
  const response = await fetch(`${HUBSPOT_API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || `HubSpot request failed with ${response.status}.`)
  }

  return data
}

async function hubspotSend(path, options = {}) {
  const token = requireHubSpotToken()
  const response = await fetch(`${HUBSPOT_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || `HubSpot request failed with ${response.status}.`)
  }

  return data
}

function getConfiguredPrioritySellers() {
  const disabledSlugs = new Set(
    (process.env.HUBSPOT_DISABLED_SELLER_SLUGS || DEFAULT_DISABLED_SELLER_SLUGS.join(','))
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean),
  )
  const configuredSlugs = process.env.HUBSPOT_PRIORITY_SELLER_SLUGS?.split(',')
    .map((slug) => slug.trim())
    .filter(Boolean)

  if (!configuredSlugs?.length) {
    return PRIORITY_SELLERS.filter((seller) => !disabledSlugs.has(seller.slug))
  }

  return configuredSlugs
    .map((slug) => PRIORITY_SELLERS.find((seller) => seller.slug === slug))
    .filter(Boolean)
    .filter((seller) => !disabledSlugs.has(seller.slug))
}

function getConfiguredCustomerServiceTeam() {
  const defaultTeam = CUSTOMER_SERVICE_TEAM.map((member) =>
    member.name === 'Alice' && process.env.HUBSPOT_ALICE_MEETING_SLUG
      ? { ...member, slug: process.env.HUBSPOT_ALICE_MEETING_SLUG }
      : member,
  ).filter((member) => member.slug)
  const configuredSlugs = process.env.HUBSPOT_CS_TEAM_SLUGS?.split(',')
    .map((slug) => slug.trim())
    .filter(Boolean)

  if (!configuredSlugs?.length) {
    return defaultTeam
  }

  return configuredSlugs
    .map((slug) => defaultTeam.find((member) => member.slug === slug))
    .filter(Boolean)
}

function filterSellersByPreference(sellers, preferredSpecialist) {
  const normalizedPreference = normalizeText(preferredSpecialist)

  if (!normalizedPreference) {
    return sellers
  }

  const matchingSellers = sellers.filter((seller) => {
    const sellerText = normalizeText(`${seller.name} ${seller.fieldValue} ${seller.slug}`)
    return sellerText.includes(normalizedPreference) || normalizedPreference.includes(normalizeText(seller.name))
  })

  return matchingSellers.length ? matchingSellers : sellers
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function requireHubSpotToken() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN

  if (!token) {
    throw new Error('HUBSPOT_PRIVATE_APP_TOKEN is not configured.')
  }

  return token
}

function formatSpecialistSlot({ specialistName, timestamp, timezone }) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    timeZoneName: 'short',
  })

  return `Specialist ${specialistName} is available ${formatter.format(new Date(timestamp))}`
}

function resolveLocale(language) {
  const normalized = String(language || '').toLowerCase()

  if (normalized.includes('spanish') || normalized.startsWith('es')) {
    return 'es'
  }

  if (normalized.startsWith('portuguese') || normalized.startsWith('pt')) {
    return 'pt-br'
  }

  return 'en-us'
}

function parsePreferredWeekday(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const weekdaysEnglish = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const weekdaysSpanish = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  const weekdaysPortuguese = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

  for (let i = 0; i < 7; i++) {
    if (
      normalized.includes(weekdaysEnglish[i]) ||
      normalized.includes(weekdaysSpanish[i]) ||
      normalized.includes(weekdaysPortuguese[i])
    ) {
      return i // 0 for Sunday, 1 for Monday, etc.
    }
  }

  return null
}
