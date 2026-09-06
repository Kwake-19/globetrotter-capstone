const { v4: uuidv4 } = require('uuid');

/**
 * Shared helpers for the social layer (follows, conversations). All take an
 * already-loaded `db` object (from readDB()) and never touch disk themselves -
 * the caller decides when to writeDB().
 *
 * Follows are asymmetric, Instagram-style: one `follows` row per direction, so a
 * mutual pair is two rows. DMs are gated on `isMutual`.
 */

function ensureSocialArrays(db) {
  if (!Array.isArray(db.follows)) db.follows = [];
  if (!Array.isArray(db.conversations)) db.conversations = [];
  if (!Array.isArray(db.messages)) db.messages = [];
  return db;
}

/** A public view of a user - never leaks email/phone/passwordHash. */
function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, username: user.username };
}

function isFollowing(db, followerId, followeeId) {
  return (db.follows || []).some((f) => f.followerId === followerId && f.followeeId === followeeId);
}

function isMutual(db, a, b) {
  return isFollowing(db, a, b) && isFollowing(db, b, a);
}

/** Ids of everyone `userId` follows. */
function followingIds(db, userId) {
  return (db.follows || []).filter((f) => f.followerId === userId).map((f) => f.followeeId);
}

/** Ids of everyone who follows `userId`. */
function followerIds(db, userId) {
  return (db.follows || []).filter((f) => f.followeeId === userId).map((f) => f.followerId);
}

/** Always [min, max] so a conversation between a pair is stored once. */
function sortedPair(a, b) {
  return [a, b].sort();
}

function findConversation(db, a, b) {
  const [x, y] = sortedPair(a, b);
  return (db.conversations || []).find(
    (c) => c.participantIds[0] === x && c.participantIds[1] === y
  ) || null;
}

/**
 * Returns { conversation, created }. Mutates db.conversations when it creates
 * one - the caller is responsible for writeDB().
 */
function getOrCreateConversation(db, a, b) {
  const existing = findConversation(db, a, b);
  if (existing) return { conversation: existing, created: false };

  const conversation = {
    id: uuidv4(),
    participantIds: sortedPair(a, b),
    createdAt: new Date().toISOString()
  };
  db.conversations.push(conversation);
  return { conversation, created: true };
}

module.exports = {
  ensureSocialArrays,
  publicUser,
  isFollowing,
  isMutual,
  followingIds,
  followerIds,
  sortedPair,
  findConversation,
  getOrCreateConversation
};
