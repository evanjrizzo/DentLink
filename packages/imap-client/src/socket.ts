import { ImapProtocolClient, type ImapSocket } from "./protocol";

export type ImapSocketFactory = (host: string, port: number) => Promise<ImapSocket>;

export async function openImapClient(
  socketFactory: ImapSocketFactory,
  host: string,
  port: number
): Promise<ImapProtocolClient> {
  return ImapProtocolClient.fromSocket(await socketFactory(host, port));
}
