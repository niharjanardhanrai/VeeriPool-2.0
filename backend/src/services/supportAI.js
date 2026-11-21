const Anthropic = require('@anthropic-ai/sdk');
const { SAFE_HOTSPOTS } = require('../utils/hotspots');
const { botReply } = require('./supportBot');

// AI customer care agent for the support chat, powered by Claude. It answers
// from the app knowledge below, keeps the conversation going across turns,
// and flags threads that need a human (the admin Support inbox) or are
// emergencies. Without ANTHROPIC_API_KEY — or if the API call fails — it
// falls back to the keyword FAQ bot so support keeps working.
const MODEL = 'claude-opus-5';
const HISTORY_LIMIT = 30;

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 30_000, maxRetries: 1 }) : null;

const hotspotLines = SAFE_HOTSPOTS.map((h) => `- ${h.label} (${h.area}): ${h.why}`).join('\n');

// Stable for every request, so it's cached (prompt caching is a prefix
// match — nothing per-user or time-dependent goes in here).
const SYSTEM_PROMPT = `You are the customer care assistant for VeriPool 2.o, a campus ride-sharing app for students and staff around NMAM Institute of Technology (Nitte), Karkala and Mangaluru in Karnataka, India. You chat with riders and drivers inside the app's Help screen. A human support team (the app's admins) can read every conversation and reply themselves.

How the app works:
- Registration: users register with their university ID, name, phone and password, then verify their email with a 6-digit code (it can be resent after 30 seconds; check spam). Riders are approved as soon as the code is verified. Drivers also upload a driving licence photo that is checked automatically: first and last name, a licence number and a future expiry date must all be readable. Failing drivers are rejected with the reason and can register again with a clearer, well-lit photo of the whole card.
- Login: auto-generated username (first.last) or email, plus password.
- Requesting a ride: the rider taps "Where to?", picks a pickup (their current GPS location or a hotspot) and a drop-off, sets the seat count and confirms. The request goes to every available driver with enough seats, first come first served. A rider can cancel while the request is still waiting for a driver.
- During a ride the driver moves through: start journey, head to pickup, I've arrived, start ride, end ride, finish. The rider sees the stage and the car's live location. Rider and driver can message each other with the in-ride chat.
- GPS: users must allow location access. On a laptop, Windows Settings > Privacy & security > Location must be on; then tap "Try again" on the location card. Browser GPS only works on https or localhost.
- Drivers turn "Available" on to receive requests.
- Posted rides: a driver can also tap "Post a ride", choose a start, a destination, optional stops to pass through, seats and a departure time. The app suggests route options (Fastest, Most riders on the way, Direct, or the driver's own stops); every stop is a safe hotspot. Riders tap "Find a posted ride", pick where they are and where they're going, and book seats on a ride that passes within about 600 m of them; they board and get off at stops on the route. Riders can cancel a booking until the driver starts the ride.
- Fair fares: fares are a cost share, not a taxi fare. The trip's fuel + wear cost (about Rs 8.4 per km) is split equally on every leg between the driver and everyone on board for that leg, so riders pay only for the distance they travel, more riders make it cheaper for everyone, there is no surge pricing, and the driver makes no profit. A rider never pays more than the fare quoted when they booked. For on-demand requests, the trip cost is split between the driver and the requested seats.
- The app shows fares but does not process payments; riders pay the driver directly. Refunds and ratings are not handled in the app. Do not invent prices, policies, refunds or features.

Safe drop-off hotspots (20 each in Nitte, Karkala, Mulki, Surathkal and Mangaluru): for safety, riders can ONLY be dropped off at one of these public, well-lit places that are staffed or busy, and posted rides only stop at them:
${hotspotLines}

How to respond:
- Be warm, brief and practical: usually 1-4 short sentences, plain text, no markdown headings or tables. Answer in the user's language if they don't write in English.
- Only state facts from the information above or the conversation. If you don't know, say a support team member will follow up rather than guessing.
- Messages starting with "[Support agent ...]" were written by a human on the support team; stay consistent with them.
- Set needs_human to true when a person must act: complaints about a driver or rider, lost items after a ride, account or data problems you can't solve, safety concerns, anything involving money, or when the user asks for a human. Then tell the user a support team member will reply here.
- Set emergency to true if anyone may be in danger (harassment, threats, accident, medical issue, feeling unsafe). Your reply must tell them to call 112 (India's emergency number) immediately, and that the support team has been alerted. Also set needs_human to true.`;

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'The message to show the user' },
    needs_human: { type: 'boolean', description: 'A human support agent should look at this conversation' },
    emergency: { type: 'boolean', description: 'Someone may be in danger' },
  },
  required: ['reply', 'needs_human', 'emergency'],
  additionalProperties: false,
};

function isEnabled() {
  return Boolean(client);
}

// Support thread -> Claude messages. User messages are the "user" turn;
// bot and human-agent messages are the "assistant" side (agents labelled
// so the model knows a person said it). Must start with a user turn.
function toClaudeMessages(thread) {
  const recent = thread.slice(-HISTORY_LIMIT);
  const firstUser = recent.findIndex((m) => m.from === 'user');
  if (firstUser === -1) return [];
  return recent.slice(firstUser).map((m) => {
    if (m.from === 'user') return { role: 'user', content: m.text };
    if (m.from === 'agent') {
      const label = m.agent?.firstName ? `[Support agent ${m.agent.firstName}]` : '[Support agent]';
      return { role: 'assistant', content: `${label}: ${m.text}` };
    }
    return { role: 'assistant', content: m.text };
  });
}

function describeUser(user, latestRide) {
  const lines = [`The user you are chatting with: ${user.firstName} ${user.lastName}, a ${user.role}.`];
  if (latestRide) {
    lines.push(
      `Their most recent ride: status "${latestRide.status}", stage "${latestRide.stage}", ` +
        `from "${latestRide.pickup?.address || 'a GPS location'}" to "${latestRide.dropoff?.address || 'unknown'}", ` +
        `requested ${new Date(latestRide.requestedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
    );
  }
  return lines.join('\n');
}

function keywordFallback(text) {
  const r = botReply(text);
  const emergency = r.text.includes('112');
  return { text: r.text, needsHuman: r.needsAgent, emergency, source: 'faq' };
}

// Returns { text, needsHuman, emergency, source: 'ai' | 'faq' }.
async function generateReply({ user, thread, latestRide }) {
  const lastUserText = [...thread].reverse().find((m) => m.from === 'user')?.text || '';
  if (!client) return keywordFallback(lastUserText);

  const messages = toClaudeMessages(thread);
  if (messages.length === 0) return keywordFallback(lastUserText);

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: describeUser(user, latestRide) },
      ],
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return {
        text: 'Thanks for your message. A member of our support team will reply here shortly.',
        needsHuman: true,
        emergency: false,
        source: 'ai',
      };
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    const parsed = JSON.parse(textBlock.text);
    return {
      text: String(parsed.reply).trim(),
      needsHuman: Boolean(parsed.needs_human || parsed.emergency),
      emergency: Boolean(parsed.emergency),
      source: 'ai',
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('Support AI: invalid ANTHROPIC_API_KEY — using FAQ bot');
    } else if (err instanceof Anthropic.RateLimitError) {
      console.error('Support AI: rate limited — using FAQ bot');
    } else if (err instanceof Anthropic.APIError) {
      console.error(`Support AI: API error ${err.status} — using FAQ bot:`, err.message);
    } else {
      console.error('Support AI: failed — using FAQ bot:', err.message);
    }
    return keywordFallback(lastUserText);
  }
}

module.exports = { generateReply, isEnabled, MODEL };
