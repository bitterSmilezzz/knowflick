/** Wails 预览暂未接入系统通知：如实报告未授权，避免静默丢弃提醒。 */
export async function isPermissionGranted(): Promise<boolean> { return false; }
export async function requestPermission(): Promise<"granted" | "denied" | "default"> { return "denied"; }
export async function sendNotification(): Promise<void> {}
