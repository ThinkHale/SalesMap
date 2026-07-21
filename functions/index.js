// functions/index.js — Cloud Functions for SalesMap
//
// scoutChat: a callable proxy for the Scout AI assistant. It keeps the OpenAI API
// key server-side (Secret Manager) so end users never need — and never see — a key.
// Requires a valid Firebase Auth token; the app signs users in anonymously, so any
// app client qualifies. For stronger gating, enable Firebase App Check and add an
// `enforceAppCheck: true` option below.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

// Force a specific model server-side to control cost, regardless of what the client
// requests (protects the shared key from expensive-model requests). Set to null to
// instead honor the client's requested model.
const FORCED_MODEL = 'gpt-4o-mini';

exports.scoutChat = onCall(
  {
    secrets: [OPENAI_API_KEY],
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 60,
    memory: '256MiB',
    // enforceAppCheck: true, // uncomment once App Check is configured
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to use Scout.');
    }

    const data = request.data || {};
    const messages = data.messages;
    const tools = data.tools;

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError('invalid-argument', 'messages[] is required.');
    }
    if (messages.length > 60) {
      throw new HttpsError('invalid-argument', 'Conversation too long.');
    }

    const model = FORCED_MODEL || (typeof data.model === 'string' ? data.model : 'gpt-4o-mini');

    let resp;
    try {
      resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY.value()}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: Array.isArray(tools) ? tools : undefined,
          tool_choice: Array.isArray(tools) && tools.length ? 'auto' : undefined,
          temperature: 0.3,
        }),
      });
    } catch (e) {
      throw new HttpsError('unavailable', 'Could not reach OpenAI.');
    }

    if (!resp.ok) {
      let detail = '';
      try {
        const j = await resp.json();
        detail = j && j.error && j.error.message ? j.error.message : '';
      } catch (e) { /* ignore */ }
      throw new HttpsError('internal', `OpenAI ${resp.status}: ${detail || resp.statusText}`);
    }

    return await resp.json();
  }
);
