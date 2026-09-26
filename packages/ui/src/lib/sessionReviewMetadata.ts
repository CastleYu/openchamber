import type { Metadata, Session } from '@/lib/opencode/model';
import { z } from 'zod';

export type SessionMetadataRecord = Metadata;

const metadataSchema = z.record(z.string(), z.json());

export const getSessionMetadata = (session: Session | null | undefined): SessionMetadataRecord => {
  return session?.metadata ?? {};
};

const getOpenChamberMetadata = (metadata: SessionMetadataRecord): Metadata =>
  metadataSchema.safeParse(metadata.openchamber).data ?? {};

export const getReviewSessionID = (session: Session | null | undefined): string | null => {
  const value = getOpenChamberMetadata(getSessionMetadata(session)).reviewSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const getOriginalSessionID = (session: Session | null | undefined): string | null => {
  const value = getOpenChamberMetadata(getSessionMetadata(session)).originalSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const isReviewSession = (session: Session | null | undefined): boolean =>
  getOpenChamberMetadata(getSessionMetadata(session)).kind === 'review' && Boolean(getOriginalSessionID(session));

export const withReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getOpenChamberMetadata(metadata);
  return {
    ...metadata,
    openchamber: {
      ...current,
      reviewSessionID,
    },
  };
};

export const withReviewSessionMarker = (
  metadata: SessionMetadataRecord,
  originalSessionID: string,
): SessionMetadataRecord => {
  const current = getOpenChamberMetadata(metadata);
  return {
    ...metadata,
    openchamber: {
      ...current,
      kind: 'review' as const,
      originalSessionID,
    },
  };
};

export const withoutReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getOpenChamberMetadata(metadata);
  if (current.reviewSessionID !== reviewSessionID) return metadata;

  const restOpenChamber = { ...current };
  delete restOpenChamber.reviewSessionID;
  const next: SessionMetadataRecord = { ...metadata };
  if (Object.keys(restOpenChamber).length > 0) {
    next.openchamber = restOpenChamber;
  } else {
    delete next.openchamber;
  }
  return next;
};
