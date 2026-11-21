// Instant first-line answers for the customer care chat. Keyword matching,
// no AI service needed. Anything it can't answer is left for a support agent
// (an admin), who sees every thread in the Support inbox.
const FAQ = [
  {
    keywords: [
      'emergency', 'danger', 'unsafe', 'accident', 'harass', 'help me', 'sos', 'threat',
      'following me', 'followed', 'stalk', 'scared', 'attack', 'hurt', 'injured', 'police',
    ],
    answer:
      'If you are in danger, call 112 (national emergency) right now. ' +
      'A support agent has been alerted to this conversation and will reply here as soon as possible.',
  },
  {
    keywords: ['hotspot', 'drop off', 'drop-off', 'dropoff', 'safe spot', 'where can i get dropped'],
    answer:
      'For your safety, drop-offs are only at safe hotspots: public, well-lit places that are staffed or busy ' +
      'around the clock (police stations, hospitals, bus stands, campus gates) in Nitte, Karkala, Mulki, Surathkal and Mangaluru. ' +
      'Pick one under "Where to (drop-off)" when you request a ride.',
  },
  {
    keywords: ['post a ride', 'posted ride', 'offer a ride', 'share my route', 'find a ride', 'book a seat', 'booking'],
    answer:
      'Drivers can tap "Post a ride" to share a route (start, destination, stops on the way, seats, time). ' +
      'Riders tap "Find a posted ride" to book a seat on a ride passing within a short walk, boarding and getting ' +
      'off at safe hotspots on the route. You can cancel a booking until the driver starts the ride.',
  },
  {
    keywords: ['fare', 'price', 'cost', 'how much', 'pay', 'charge'],
    answer:
      'Fares are a fair cost share, not a taxi price: the fuel + wear cost (about Rs 8.4/km) of each part of the ' +
      'route is split equally between the driver and everyone on board for it. You only pay for the distance you ' +
      'travel, it gets cheaper when more people share, there is no surge, and you never pay more than your quote. ' +
      'Pay the driver directly.',
  },
  {
    keywords: ['cancel'],
    answer:
      'You can cancel a ride while it is still waiting for a driver: open the active ride on your home screen and ' +
      'tap Cancel. Once a driver has accepted, message them in the ride chat or reply here and an agent will help.',
  },
  {
    keywords: ['lost', 'forgot', 'left my', 'bag', 'phone', 'wallet'],
    answer:
      'Sorry about that! Open your ride and use the ride chat to message the driver directly. If the ride has ' +
      'finished or the driver doesn’t reply, tell us the date, pickup and drop-off and an agent will follow up.',
  },
  {
    keywords: ['gps', 'location', 'map', 'tracking', 'not moving'],
    answer:
      'For live location: allow location access when your browser/phone asks. On a laptop, also turn on ' +
      'Windows Settings → Privacy & security → Location. Then tap "Try again" on the location card.',
  },
  {
    keywords: ['otp', 'code', 'verify', 'verification', 'email'],
    answer:
      'Your 6-digit verification code is sent to the email you registered with — check spam too. ' +
      'You can request a new code after 30 seconds from the verification screen.',
  },
  {
    keywords: ['license', 'licence', 'rejected', 'driver registration', 'become a driver'],
    answer:
      'Driver licenses are checked automatically: your first and last name, a license number and a future ' +
      'expiry date must all be readable in the photo. If you were rejected, register again with a clearer, ' +
      'well-lit photo of the whole card.',
  },
  {
    keywords: ['password', 'login', 'log in', 'username', 'sign in'],
    answer:
      'You log in with your auto-generated username (first.last) or your email, plus your password. ' +
      'If you still can’t get in, tell us your registered email and an agent will help.',
  },
  {
    keywords: ['driver late', 'driver not', 'no driver', 'waiting', 'no one accepted'],
    answer:
      'Requests go to available drivers first-come-first-served. If nobody accepts after a few minutes, ' +
      'cancel and request again, or pick a nearby hotspot as your pickup.',
  },
  {
    keywords: ['agent', 'human', 'person', 'talk to', 'call me', 'complaint', 'report'],
    answer: 'Sure, a support agent will reply here shortly. Please describe what happened in as much detail as you can.',
  },
  {
    keywords: ['hi', 'hello', 'hey', 'namaste'],
    answer:
      'Hi! I’m the VeriPool support bot. Ask me about safe drop-off hotspots, cancelling a ride, lost items, ' +
      'GPS, OTP codes or driver registration, or type "agent" to reach a person.',
  },
];

const FALLBACK = 'Thanks for reaching out! A support agent will reply here soon.';

function matches(text, keyword) {
  // Whole-word match for short keywords like "hi" so "this" doesn't trigger it.
  if (keyword.length <= 3) return new RegExp(`\\b${keyword}\\b`).test(text);
  return text.includes(keyword);
}

// Returns { text, needsAgent } — needsAgent is true when a person should look.
function botReply(message) {
  const text = message.toLowerCase();
  const hit = FAQ.find((f) => f.keywords.some((k) => matches(text, k)));
  if (!hit) return { text: FALLBACK, needsAgent: true };
  const needsAgent = hit === FAQ[0] || hit.keywords.includes('agent');
  return { text: hit.answer, needsAgent };
}

module.exports = { botReply, FALLBACK };
