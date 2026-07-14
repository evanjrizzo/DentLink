export const GMAIL_IMAP_SCOPE = "https://mail.google.com/";

export type ImapOAuthClient = {
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; scope?: string }>;
};
