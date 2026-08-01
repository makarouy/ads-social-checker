export const getStatusEmoji = (status) => {
  switch (status?.toUpperCase()) {
    case "LIVE":
      return "🟢 LIVE";
    case "DISABLED":
    case "DELETED":
    case "NOT_FOUND":
      return "🔴 " + status.toUpperCase();
    case "LOGIN_REQUIRED":
    case "RATE_LIMITED":
      return "🟡 " + status.toUpperCase();
    default:
      return "⚪ " + (status || "UNKNOWN").toUpperCase();
  }
};
