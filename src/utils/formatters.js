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

export const formatCambodiaTime = (date) => {
  if (!date) return "N/A";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(d);
};
