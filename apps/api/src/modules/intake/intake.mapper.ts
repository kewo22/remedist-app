import {
  intakeDeadline,
  type AnatomySegment,
  type IntakeAnswers,
  type IntakeForm,
  type IntakeFormSummary,
  type IntakePainPoint,
  type IntakePainPointInput,
  type IntakePhoto,
} from '@remedist/shared';
import type { AnatomySegmentRow, IntakeFormRow, IntakePhotoRow } from './intake.repository';

// Database rows → contract shapes. Timestamps become ISO strings.

export function toAnatomySegment(row: AnatomySegmentRow): AnatomySegment {
  return { id: row.id, category: row.category, name: row.name, displayOrder: row.display_order };
}

export function toIntakeSummary(row: IntakeFormRow): IntakeFormSummary {
  return {
    id: row.id,
    contactId: row.contact_id,
    bookingId: row.booking_id,
    probonoEntryId: row.probono_entry_id,
    sessionStart: row.session_start?.toISOString() ?? null,
    deadline: row.session_start ? intakeDeadline(row.session_start).toISOString() : null,
    status: row.status,
    completedAt: row.completed_at?.toISOString() ?? null,
    completedVia: row.completed_via,
  };
}

/** Stored pain points with their segment names, worst first. A segment that no longer exists is left out. */
export function toPainPoints(
  stored: readonly IntakePainPointInput[] | null,
  segments: ReadonlyMap<string, AnatomySegmentRow>,
): IntakePainPoint[] {
  return (stored ?? [])
    .flatMap((point) => {
      const segment = segments.get(point.segmentId);
      return segment ? [{ segmentId: point.segmentId, rank: point.rank, segmentName: segment.name, category: segment.category }] : [];
    })
    .sort((a, b) => a.rank - b.rank);
}

export function toIntakePhoto(row: IntakePhotoRow): IntakePhoto {
  return { side: row.side, contentType: row.content_type, sizeBytes: row.size_bytes, uploadedAt: row.created_at.toISOString() };
}

export function toIntakeForm(
  row: IntakeFormRow,
  photos: readonly IntakePhotoRow[],
  segments: ReadonlyMap<string, AnatomySegmentRow>,
): IntakeForm {
  return {
    ...toIntakeSummary(row),
    formVersion: row.form_version,
    // Only a submitted form has answers; a pending one stores '{}'.
    answers: row.status === 'completed' ? (row.answers as IntakeAnswers) : null,
    painPoints: toPainPoints(row.pain_points, segments),
    problemDescription: row.problem_description,
    photos: photos.map(toIntakePhoto),
  };
}
