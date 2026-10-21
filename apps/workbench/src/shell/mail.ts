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
}
export interface MailAccount extends MailAccountConfig {
  lastSyncAt: number | null;
  lastError: string | null;
  hasPassword: boolean;
}
export interface MailSyncResult {
  accountId: string;
  imported: number;
  skipped: number;
  /** Messages this run could not read and has set aside for good. */
  rejected: number;
  lastSyncAt: number;
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
