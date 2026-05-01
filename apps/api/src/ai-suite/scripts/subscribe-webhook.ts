import 'dotenv/config'

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const TOKEN = process.env.WHATSAPP_TOKEN

if (!PHONE_NUMBER_ID) {
  console.error('ERROR: WHATSAPP_PHONE_NUMBER_ID is not set in environment')
  process.exit(1)
}

if (!TOKEN) {
  console.error('ERROR: WHATSAPP_TOKEN is not set in environment')
  process.exit(1)
}

async function subscribeWebhook() {
  const url = `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/subscribed_apps`

  console.log(`POST ${url}`)
  console.log(`Authorization: Bearer ${TOKEN!.slice(0, 20)}...`)
  console.log()

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  })

  const body = await res.json()

  console.log(`Status: ${res.status} ${res.statusText}`)
  console.log('Response:', JSON.stringify(body, null, 2))
}

subscribeWebhook().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
