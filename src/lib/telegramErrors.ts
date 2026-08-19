export function telegramErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

export function isHtmlParseError(error: unknown): boolean {
  return /can't parse entities|can't parse|parse entities|Bad Request: .*parse/i.test(
    telegramErrorMessage(error),
  );
}

/** Chat is gone, blocked, kicked, or otherwise cannot receive messages. Retrying the webhook cannot fix this. */
export function isUnreachableChatError(error: unknown): boolean {
  return /chat not found|bot was blocked by the user|user is deactivated|bot was kicked|bot is not a member|have no rights to send|not enough rights to send|CHAT_WRITE_FORBIDDEN|PEER_ID_INVALID|TOPIC_CLOSED|bots can't send messages to bots|group chat was upgraded|chat_id is empty/i.test(
    telegramErrorMessage(error),
  );
}
