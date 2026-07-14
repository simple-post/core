import crypto from "node:crypto";

import {
  FarcasterNetwork,
  getFarcasterTime,
  getInsecureHubRpcClient,
  getSSLHubRpcClient,
  KeyAddBody,
  KeyRemoveBody,
  makeMessage,
  MessageData,
  MessageType,
  NobleEd25519Signer,
  UserNameType,
} from "@farcaster/hub-nodejs";
import { bytesToHex, encodeAbiParameters, getAddress, hexToBytes, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getEncryptionProvider, isEncryptedValue } from "@/lib/security/encryption";

import type { HubRpcClient, HubResult, Message } from "@farcaster/hub-nodejs";
import type { Address, Hex } from "viem";

const ETH_MAINNET_CHAIN_ID = 1;
const KEY_TYPE_ED25519 = 1;
const METADATA_TYPE_SIGNED_KEY_REQUEST = 1;
const SELF_REVOKE_SIGNATURE_TYPE = 2;
const REQUEST_TOKEN_TTL_MS = 10 * 60 * 1000;
const SIGNATURE_DEADLINE_SECONDS = 10 * 60;
const DEFAULT_SIGNER_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_SIGNER_TTL_SECONDS = 90 * 24 * 60 * 60;
const CAST_SCOPES = [MessageType.CAST_ADD, MessageType.CAST_REMOVE] as const;

const EIP712_DOMAIN_TYPES = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
] as const;

const KEY_ADD_TYPES = [
  { name: "fid", type: "uint256" },
  { name: "key", type: "bytes" },
  { name: "keyType", type: "uint32" },
  { name: "scopes", type: "uint32[]" },
  { name: "ttl", type: "uint32" },
  { name: "nonce", type: "uint32" },
  { name: "deadline", type: "uint256" },
] as const;

const SIGNED_KEY_REQUEST_TYPES = [
  { name: "requestFid", type: "uint256" },
  { name: "key", type: "bytes" },
  { name: "deadline", type: "uint256" },
] as const;

const KEY_DOMAIN = {
  name: "Farcaster KeyAdd",
  version: "1",
  chainId: ETH_MAINNET_CHAIN_ID,
} as const;

interface FarcasterConfig {
  appCustodyPrivateKey: Hex;
  appFid: number;
  endpoints: string[];
  signerTtlSeconds: number;
}

interface KeyAddTokenPayload {
  version: 1;
  purpose: "farcaster-key-add";
  userId: string;
  custodyAddress: Address;
  fid: number;
  signerPrivateKey: Hex;
  signerPublicKey: Hex;
  nonce: number;
  deadline: number;
  expiresAt: number;
  scopes: number[];
  ttl: number;
}

export interface FarcasterKeyAddTypedData {
  domain: typeof KEY_DOMAIN;
  types: {
    EIP712Domain: typeof EIP712_DOMAIN_TYPES;
    KeyAdd: typeof KEY_ADD_TYPES;
  };
  primaryType: "KeyAdd";
  message: {
    fid: number;
    key: Hex;
    keyType: number;
    scopes: number[];
    ttl: number;
    nonce: number;
    deadline: number;
  };
}

export interface PreparedFarcasterConnection {
  fid: number;
  custodyAddress: Address;
  requestToken: string;
  typedData: FarcasterKeyAddTypedData;
  signerExpiresInSeconds: number;
}

export interface CompletedFarcasterConnection {
  fid: number;
  signerPrivateKey: Hex;
  signerPublicKey: Hex;
  custodyAddress: Address;
  username: string | null;
  expiresAt: Date;
  scopes: number[];
  ttl: number;
  requestFid: number;
}

export class FarcasterProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FarcasterProtocolError";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new FarcasterProtocolError(`Farcaster is not configured: ${name} is required`);
  return value;
}

function getConfig(): FarcasterConfig {
  const appFid = Number(requiredEnv("FARCASTER_APP_FID"));
  if (!Number.isSafeInteger(appFid) || appFid <= 0) {
    throw new FarcasterProtocolError("Farcaster is not configured: FARCASTER_APP_FID must be a positive integer");
  }

  const rawPrivateKey = requiredEnv("FARCASTER_APP_CUSTODY_PRIVATE_KEY");
  const appCustodyPrivateKey = (rawPrivateKey.startsWith("0x") ? rawPrivateKey : `0x${rawPrivateKey}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(appCustodyPrivateKey)) {
    throw new FarcasterProtocolError(
      "Farcaster is not configured: FARCASTER_APP_CUSTODY_PRIVATE_KEY must be a 32-byte hex key",
    );
  }

  const endpoints = requiredEnv("FARCASTER_SNAPCHAIN_URLS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (endpoints.length === 0) {
    throw new FarcasterProtocolError("Farcaster is not configured: at least one Snapchain endpoint is required");
  }

  const configuredTtl = Number(process.env.FARCASTER_SIGNER_TTL_SECONDS || DEFAULT_SIGNER_TTL_SECONDS);
  if (!Number.isSafeInteger(configuredTtl) || configuredTtl <= 0 || configuredTtl > MAX_SIGNER_TTL_SECONDS) {
    throw new FarcasterProtocolError(`FARCASTER_SIGNER_TTL_SECONDS must be between 1 and ${MAX_SIGNER_TTL_SECONDS}`);
  }

  return { appCustodyPrivateKey, appFid, endpoints, signerTtlSeconds: configuredTtl };
}

function getFarcasterTimestamp(): number {
  const timestamp = getFarcasterTime();
  if (timestamp.isErr()) throw new FarcasterProtocolError(timestamp.error.message);
  return timestamp.value;
}

function createClient(endpoint: string): HubRpcClient {
  const normalized = endpoint.trim().replace(/\/$/, "");
  const insecure = normalized.startsWith("grpc://");
  const address = normalized.replace(/^grpcs?:\/\//, "");
  if (!address || address.includes("/")) {
    throw new FarcasterProtocolError(`Invalid Snapchain endpoint: ${endpoint}. Expected grpcs://host:port`);
  }
  return insecure ? getInsecureHubRpcClient(address) : getSSLHubRpcClient(address);
}

async function runRpc<T>(operation: (client: HubRpcClient) => Promise<HubResult<T>>): Promise<T> {
  const errors: string[] = [];
  for (const endpoint of getConfig().endpoints) {
    const client = createClient(endpoint);
    try {
      const result = await operation(client);
      if (result.isOk()) return result.value;
      errors.push(result.error.message);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      client.close();
    }
  }
  throw new FarcasterProtocolError(`Snapchain request failed: ${errors.join("; ") || "unknown error"}`);
}

async function submitMessage(message: Message): Promise<void> {
  const errors: string[] = [];
  for (const endpoint of getConfig().endpoints) {
    const client = createClient(endpoint);
    try {
      const result = await client.submitMessage(message);
      if (result.isOk() || result.error.errCode === "bad_request.duplicate") return;
      errors.push(result.error.message);
      if (result.error.errCode !== "unknown" && !result.error.errCode.startsWith("unavailable")) break;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      client.close();
    }
  }
  throw new FarcasterProtocolError(`Snapchain rejected the signer message: ${errors.join("; ") || "unknown error"}`);
}

async function signerExists(fid: number, signer: Uint8Array): Promise<boolean> {
  const errors: string[] = [];
  for (const endpoint of getConfig().endpoints) {
    const client = createClient(endpoint);
    try {
      const result = await client.getSigner({ fid, signer });
      if (result.isOk()) return Boolean(result.value.signer);
      if (result.error.errCode === "not_found") return false;
      errors.push(result.error.message);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      client.close();
    }
  }
  throw new FarcasterProtocolError(`Could not verify the Farcaster signer: ${errors.join("; ") || "unknown error"}`);
}

async function resolveFidForCustodyAddress(address: Address): Promise<number> {
  const event = await runRpc((client) => client.getIdRegistryOnChainEventByAddress({ address: hexToBytes(address) }));
  const currentCustody = event.idRegisterEventBody?.to;
  if (!event.fid || !currentCustody || bytesToHex(currentCustody).toLowerCase() !== address.toLowerCase()) {
    throw new FarcasterProtocolError("The connected wallet is not the current custody address of a Farcaster FID");
  }
  return event.fid;
}

function keyAddTypedData(payload: KeyAddTokenPayload): FarcasterKeyAddTypedData {
  return {
    domain: KEY_DOMAIN,
    types: { EIP712Domain: EIP712_DOMAIN_TYPES, KeyAdd: KEY_ADD_TYPES },
    primaryType: "KeyAdd",
    message: {
      fid: payload.fid,
      key: payload.signerPublicKey,
      keyType: KEY_TYPE_ED25519,
      scopes: payload.scopes,
      ttl: payload.ttl,
      nonce: payload.nonce,
      deadline: payload.deadline,
    },
  };
}

function encodeToken(payload: KeyAddTokenPayload): string {
  return getEncryptionProvider().encrypt(JSON.stringify(payload));
}

function decodeToken(token: string, userId: string): KeyAddTokenPayload {
  if (!isEncryptedValue(token)) throw new FarcasterProtocolError("Invalid Farcaster authorization request");
  let payload: KeyAddTokenPayload;
  try {
    payload = JSON.parse(getEncryptionProvider().decrypt(token)) as KeyAddTokenPayload;
  } catch {
    throw new FarcasterProtocolError("Invalid Farcaster authorization request");
  }
  if (
    payload.version !== 1 ||
    payload.purpose !== "farcaster-key-add" ||
    payload.userId !== userId ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt <= Date.now() ||
    !Number.isSafeInteger(payload.fid) ||
    payload.fid <= 0 ||
    !Number.isSafeInteger(payload.nonce) ||
    payload.nonce <= 0 ||
    !Number.isSafeInteger(payload.deadline) ||
    payload.deadline <= getFarcasterTimestamp() ||
    !Number.isSafeInteger(payload.ttl) ||
    payload.ttl <= 0 ||
    payload.ttl > MAX_SIGNER_TTL_SECONDS ||
    !Array.isArray(payload.scopes) ||
    payload.scopes.length !== CAST_SCOPES.length ||
    !CAST_SCOPES.every((scope, index) => payload.scopes[index] === scope) ||
    !/^0x[0-9a-fA-F]{40}$/.test(payload.custodyAddress) ||
    !/^0x[0-9a-fA-F]{64}$/.test(payload.signerPrivateKey) ||
    !/^0x[0-9a-fA-F]{64}$/.test(payload.signerPublicKey)
  ) {
    throw new FarcasterProtocolError("The Farcaster authorization request is invalid or has expired");
  }
  return payload;
}

async function verifyAppConfiguration(config: FarcasterConfig): Promise<void> {
  const appAccount = privateKeyToAccount(config.appCustodyPrivateKey);
  const resolvedAppFid = await resolveFidForCustodyAddress(appAccount.address);
  if (resolvedAppFid !== config.appFid) {
    throw new FarcasterProtocolError("FARCASTER_APP_FID does not belong to FARCASTER_APP_CUSTODY_PRIVATE_KEY");
  }
}

export async function prepareFarcasterConnection(
  userId: string,
  rawCustodyAddress: string,
): Promise<PreparedFarcasterConnection> {
  let custodyAddress: Address;
  try {
    custodyAddress = getAddress(rawCustodyAddress);
  } catch {
    throw new FarcasterProtocolError("A valid Ethereum custody address is required");
  }

  const config = getConfig();
  const [fid] = await Promise.all([resolveFidForCustodyAddress(custodyAddress), verifyAppConfiguration(config)]);
  const signerState = await runRpc((client) => client.getSignersByFid({ fid, requesterFids: [] }));
  if (signerState.gaslessSignerLimit > 0 && signerState.gaslessSignerCount >= signerState.gaslessSignerLimit) {
    throw new FarcasterProtocolError(
      `This FID has reached its gasless signer limit (${signerState.gaslessSignerCount}/${signerState.gaslessSignerLimit})`,
    );
  }

  const signerPrivateKey = bytesToHex(crypto.randomBytes(32));
  const signer = new NobleEd25519Signer(hexToBytes(signerPrivateKey));
  const signerKey = await signer.getSignerKey();
  if (signerKey.isErr()) throw new FarcasterProtocolError(signerKey.error.message);

  const now = getFarcasterTimestamp();
  const payload: KeyAddTokenPayload = {
    version: 1,
    purpose: "farcaster-key-add",
    userId,
    custodyAddress,
    fid,
    signerPrivateKey,
    signerPublicKey: bytesToHex(signerKey.value),
    nonce: signerState.currentUserNonce + 1,
    deadline: now + SIGNATURE_DEADLINE_SECONDS,
    expiresAt: Date.now() + REQUEST_TOKEN_TTL_MS,
    scopes: [...CAST_SCOPES],
    ttl: config.signerTtlSeconds,
  };

  return {
    fid,
    custodyAddress,
    requestToken: encodeToken(payload),
    typedData: keyAddTypedData(payload),
    signerExpiresInSeconds: payload.ttl,
  };
}

async function getUsername(fid: number): Promise<string | null> {
  try {
    const response = await runRpc((client) => client.getUserNameProofsByFid({ fid }));
    const proof = response.proofs.find(
      (entry) => entry.type === UserNameType.USERNAME_TYPE_FNAME && entry.name.length > 0,
    );
    return proof ? new TextDecoder().decode(proof.name) : null;
  } catch {
    return null;
  }
}

export async function completeFarcasterConnection(
  userId: string,
  requestToken: string,
  custodySignature: string,
): Promise<CompletedFarcasterConnection> {
  const payload = decodeToken(requestToken, userId);
  if (!/^0x[0-9a-fA-F]{130}$/.test(custodySignature)) {
    throw new FarcasterProtocolError("The custody wallet returned an invalid signature");
  }

  const typedData = keyAddTypedData(payload);
  const recoveredAddress = await recoverTypedDataAddress({
    domain: typedData.domain,
    types: { KeyAdd: KEY_ADD_TYPES },
    primaryType: "KeyAdd",
    message: {
      ...typedData.message,
      fid: BigInt(typedData.message.fid),
      deadline: BigInt(typedData.message.deadline),
    },
    signature: custodySignature as Hex,
  });
  if (recoveredAddress.toLowerCase() !== payload.custodyAddress.toLowerCase()) {
    throw new FarcasterProtocolError("The signer authorization was not signed by the FID custody wallet");
  }

  const currentFid = await resolveFidForCustodyAddress(payload.custodyAddress);
  if (currentFid !== payload.fid) {
    throw new FarcasterProtocolError("FID custody changed while the signer was being authorized; please try again");
  }

  const config = getConfig();
  const appAccount = privateKeyToAccount(config.appCustodyPrivateKey);
  const metadataSignature = await appAccount.signTypedData({
    domain: KEY_DOMAIN,
    types: { SignedKeyRequest: SIGNED_KEY_REQUEST_TYPES },
    primaryType: "SignedKeyRequest",
    message: {
      requestFid: BigInt(config.appFid),
      key: payload.signerPublicKey,
      deadline: BigInt(payload.deadline),
    },
  });
  const metadata = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "requestFid", type: "uint256" },
          { name: "requestSigner", type: "address" },
          { name: "signature", type: "bytes" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    [
      {
        requestFid: BigInt(config.appFid),
        requestSigner: appAccount.address,
        signature: metadataSignature,
        deadline: BigInt(payload.deadline),
      },
    ],
  );

  const signer = new NobleEd25519Signer(hexToBytes(payload.signerPrivateKey));
  const body = KeyAddBody.create({
    key: hexToBytes(payload.signerPublicKey),
    keyType: KEY_TYPE_ED25519,
    custodySignature: hexToBytes(custodySignature as Hex),
    deadline: payload.deadline,
    nonce: payload.nonce,
    metadata: hexToBytes(metadata),
    metadataType: METADATA_TYPE_SIGNED_KEY_REQUEST,
    registrationTxHash: new Uint8Array(),
    scopes: payload.scopes,
    ttl: payload.ttl,
  });
  const messageData = MessageData.create({
    type: MessageType.KEY_ADD,
    fid: payload.fid,
    timestamp: getFarcasterTimestamp(),
    network: FarcasterNetwork.MAINNET,
    keyAddBody: body,
  });
  const message = await makeMessage(messageData, signer);
  if (message.isErr()) throw new FarcasterProtocolError(message.error.message);
  await submitMessage(message.value);

  const registered = await runRpc((client) =>
    client.getSigner({ fid: payload.fid, signer: hexToBytes(payload.signerPublicKey) }),
  );
  const signerInfo = registered.signer;
  if (
    !signerInfo ||
    signerInfo.fid !== payload.fid ||
    bytesToHex(signerInfo.key).toLowerCase() !== payload.signerPublicKey.toLowerCase() ||
    signerInfo.requestFid !== config.appFid ||
    signerInfo.ttl !== payload.ttl ||
    !signerInfo.expiresAt ||
    signerInfo.expiresAt <= Math.floor(Date.now() / 1000) ||
    signerInfo.scopes.length !== payload.scopes.length ||
    !payload.scopes.every((scope, index) => signerInfo.scopes[index] === scope)
  ) {
    throw new FarcasterProtocolError("Snapchain accepted the request but the signer could not be verified");
  }

  return {
    fid: payload.fid,
    signerPrivateKey: payload.signerPrivateKey,
    signerPublicKey: payload.signerPublicKey,
    custodyAddress: payload.custodyAddress,
    username: await getUsername(payload.fid),
    expiresAt: new Date(signerInfo.expiresAt * 1000),
    scopes: payload.scopes,
    ttl: payload.ttl,
    requestFid: config.appFid,
  };
}

export async function revokeFarcasterSigner(fid: number, signerPrivateKey: string): Promise<void> {
  const normalizedPrivateKey = (signerPrivateKey.startsWith("0x") ? signerPrivateKey : `0x${signerPrivateKey}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey)) {
    throw new FarcasterProtocolError("Cannot revoke an invalid Farcaster signer key");
  }

  const config = getConfig();
  const signer = new NobleEd25519Signer(hexToBytes(normalizedPrivateKey));
  const signerKey = await signer.getSignerKey();
  if (signerKey.isErr()) throw new FarcasterProtocolError(signerKey.error.message);
  if (!(await signerExists(fid, signerKey.value))) return;

  const signerState = await runRpc((client) => client.getSignersByFid({ fid, requesterFids: [config.appFid] }));
  const now = getFarcasterTimestamp();
  const body = KeyRemoveBody.create({
    key: signerKey.value,
    signature: new Uint8Array(),
    signatureType: SELF_REVOKE_SIGNATURE_TYPE,
    deadline: now + SIGNATURE_DEADLINE_SECONDS,
    nonce: (signerState.requesterFidNonces[config.appFid] ?? 0) + 1,
  });
  const messageData = MessageData.create({
    type: MessageType.KEY_REMOVE,
    fid,
    timestamp: now,
    network: FarcasterNetwork.MAINNET,
    keyRemoveBody: body,
  });
  const message = await makeMessage(messageData, signer);
  if (message.isErr()) throw new FarcasterProtocolError(message.error.message);
  await submitMessage(message.value);
}
