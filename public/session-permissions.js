export function canEditSession(session, expectedUserId) {
  return Boolean(session?.user && !session.readOnly &&
    ['admin', 'editor'].includes(session.user.role) &&
    (expectedUserId === undefined || session.user.id === expectedUserId));
}
