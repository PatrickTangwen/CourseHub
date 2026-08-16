/**
 * 浏览器身份:首次访问生成持久 UUID 作为 user_id,
 * 让服务端 (user_id, conv_id) 记忆与跨会话画像真实生效。
 */
const USER_ID_KEY = "coursehub.user_id";

export function getBrowserUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}
