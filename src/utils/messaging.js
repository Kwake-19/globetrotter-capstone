const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('./dataStore');
const {
  ensureSocialArrays, isMutual, getOrCreateConversation
} = require('./social');

const MAX_TEXT_LENGTH = 2000;

/** A typed error the route/socket layers turn into an HTTP status / ack. */
function messageError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * The single code path behind both the Socket.io "send_message" event and the
 * REST POST /api/conversations/messages fallback: validate, persist through the
 * existing write queue, and hand back the message + who to deliver it to.
 *
 * A conversation is created lazily on the first message between two people who
 * currently follow each other both ways (mutual). If they aren't mutual, or one
 * of them has since unfollowed, sending fails with 403.
 */
async function sendMessage({
  senderId, conversationId, toUserId, type, text, destinationId, itineraryId
}) {
  if (!senderId) throw messageError(401, 'Not authenticated');

  const db = await readDB();
  ensureSocialArrays(db);

  // --- resolve the conversation -------------------------------------------
  let conversation;
  if (conversationId) {
    conversation = db.conversations.find((c) => c.id === conversationId);
    if (!conversation || !conversation.participantIds.includes(senderId)) {
      throw messageError(404, 'Conversation not found');
    }
  } else if (toUserId) {
    if (toUserId === senderId) throw messageError(400, 'You cannot message yourself');
    if (!db.users.find((u) => u.id === toUserId)) throw messageError(404, 'User not found');
    if (!isMutual(db, senderId, toUserId)) {
      throw messageError(403, 'You can only message people you both follow');
    }
    ({ conversation } = getOrCreateConversation(db, senderId, toUserId));
  } else {
    throw messageError(400, 'conversationId or toUserId is required');
  }

  const otherId = conversation.participantIds.find((id) => id !== senderId);
  // Re-check mutual on every send: an unfollow after the conversation existed
  // must stop new messages (history stays readable).
  if (!isMutual(db, senderId, otherId)) {
    throw messageError(403, 'You can only message people you both follow');
  }

  // --- validate by type --------------------------------------------------
  const message = {
    id: uuidv4(),
    conversationId: conversation.id,
    senderId,
    type,
    createdAt: new Date().toISOString()
  };

  if (type === 'text') {
    if (typeof text !== 'string' || !text.trim()) throw messageError(400, 'text is required');
    if (text.trim().length > MAX_TEXT_LENGTH) {
      throw messageError(400, `text must be ${MAX_TEXT_LENGTH} characters or fewer`);
    }
    message.text = text.trim();
  } else if (type === 'place') {
    const destination = db.destinations.find((d) => d.id === destinationId);
    if (!destination) throw messageError(400, 'Unknown destinationId');
    message.destinationId = destinationId;
  } else if (type === 'itinerary') {
    const itinerary = db.itineraries.find((it) => it.id === itineraryId);
    if (!itinerary) throw messageError(400, 'Unknown itineraryId');
    if (itinerary.userId !== senderId) {
      throw messageError(403, 'You can only share your own itineraries');
    }
    // The recipient isn't the owner, so /trip.html would 404 for them - they
    // need a public share link. Reuse the same shareId the Share feature mints.
    if (!itinerary.shareId) {
      itinerary.shareId = uuidv4();
    }
    message.itineraryId = itineraryId;
    message.shareId = itinerary.shareId;
  } else {
    throw messageError(400, 'type must be one of: text, place, itinerary');
  }

  db.messages.push(message);
  await writeDB(db);

  return { message, conversation, participantIds: conversation.participantIds.slice() };
}

module.exports = { sendMessage, messageError, MAX_TEXT_LENGTH };
