import { invoke } from "@tauri-apps/api/core";

/** Account metadata only. Passwords are passed to Rust and never returned to the UI. */
export interface MailAccountConfig {
  id: string;
  name: string;
  email: string;
  host: string;
  port: number;
  username: string;
  folder: string;
  syncLimit: number;
  /** 0 = manual; otherwise poll every 5–1440 minutes while the application is running. */
  syncIntervalMinutes?: number;
}
export interface MailAccount extends MailAccountConfig {
  lastSyncAt: number | null;
  lastError: string | null;
  hasPassword: boolean;
  historyComplete: boolean;
  rejectedCount: number;
  lastAttemptAt: number | null;
}
export interface MailSyncResult {
  accountId: string;
  imported: number;
  skipped: number;
  /** Messages this run could not read; inspect or retry these through the recovery panel. */
  rejected: number;
  lastSyncAt: number;
  historyComplete: boolean;
}
export interface RejectedMail {
  uid: number;
  reason: string;
  rejectedAt: number;
  folder: string;
}
export interface MailSyncOutcome {
  accountId: string;
  imported: number;
  rejected: number;
  error: string | null;
}
export interface MailConnectionResult {
  message: string;
}
export const mailListAccounts = (dir: string): Promise<MailAccount[]> => invoke("mail_list_accounts", { dir });
export const mailSaveAccount = (dir: string, config: MailAccountConfig, password: string): Promise<MailAccount> =>
  invoke("mail_save_account", { dir, config, password });
export const mailTestAccount = (dir: string, config: MailAccountConfig, password: string): Promise<MailConnectionResult> =>
  invoke("mail_test_account", { dir, config, password });
export const mailRemoveAccount = (dir: string, id: string): Promise<void> => invoke("mail_remove_account", { dir, id });
export const mailSyncAccount = (dir: string, id: string): Promise<MailSyncResult> => invoke("mail_sync_account", { dir, id });
export const mailSyncHistory = (dir: string, id: string): Promise<MailSyncResult> => invoke("mail_sync_history", { dir, id });
export const mailListRejected = (dir: string, id: string): Promise<RejectedMail[]> => invoke("mail_list_rejected", { dir, id });
export const mailRetryRejected = (dir: string, id: string): Promise<MailSyncResult> => invoke("mail_retry_rejected", { dir, id });
export const mailSyncDueAccounts = (dir: string): Promise<MailSyncOutcome[]> => invoke("mail_sync_due_accounts", { dir });
