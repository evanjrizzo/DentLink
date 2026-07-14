export function xoauth2InitialResponse(user: string, accessToken: string): string {
  return base64Ascii(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`);
}

function base64Ascii(value: string): string {
  return btoa(value);
}
