const CLIENT_KEY = "finmate.client-id.v1";
const CONVERSATION_KEY = "finmate.conversation-id.v1";

export function getClientIdentity() {
  return {
    clientId: getOrCreate(CLIENT_KEY, "client"),
    conversationId: getOrCreate(CONVERSATION_KEY, "conversation"),
  };
}

function getOrCreate(key: string, prefix: string) {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
}
