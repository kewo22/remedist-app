import type { Queryable } from '../database.service';
import type { SeedReport } from './seed-report';

// Starting content for tables staff manage in the CRM. Each set is loaded only into an empty
// table, as in the old app, so re-running the seed never brings back something staff deleted.

/**
 * The default session type: what a new slot is opened as unless staff pick another.
 * Prices are minor units: LKR 45,000.00 and USD 200.00, as in the old app.
 */
const DEFAULT_SESSION_TYPE = { name: 'Standard session', durationMinutes: 90, rateLkrMinor: 4_500_000, rateUsdMinor: 20_000 };

const FAQS: ReadonlyArray<{ question: string; answer: string; highlight: boolean }> = [
  {
    question: 'How do I book a session?',
    answer:
      'Use the Pricing + Book page on this website to pick an available time and complete payment, or message us on WhatsApp and we will help you book.',
    highlight: false,
  },
  {
    question: 'Where is The Remedist?',
    answer:
      'The clinic is in Colombo, Sri Lanka. Rauzan Aly treats clients in person — people often travel to Colombo specifically for his care.',
    highlight: false,
  },
  {
    question: 'What does Rauzan treat?',
    answer:
      'Common concerns include lower back pain, neck and shoulder stiffness, frozen shoulder, sciatica-type discomfort, joint misalignment, sports injuries, and chronic tension. The Ailments Treated page has more detail on each.',
    highlight: false,
  },
  {
    question: 'Do you offer pro-bono or reduced-fee sessions?',
    answer:
      'Yes. If cost is a barrier, you can apply through the Pro Bono page. Applications are reviewed privately by the clinic and never shown publicly.',
    highlight: true,
  },
  {
    question: 'Can the website AI diagnose my pain?',
    answer:
      'No. The on-site assistant can only answer general questions about services and FAQs. Only Rauzan can assess or diagnose during an in-person session.',
    highlight: false,
  },
];

// Migrated from the old public ailments page. No anatomy segments are assigned: mapping
// ailments to body regions is a clinical judgment for Rauzan, not something to guess.
const AILMENTS: ReadonlyArray<{ name: string; description: string; averageSessions: string }> = [
  {
    name: 'Lower back pain',
    description:
      'Manual realignment of the lower spine and pelvis, combined with soft-tissue work on the muscles that have been compensating around the affected area.',
    averageSessions: '6-8 sessions (roughly 9-12 hours) over 4-6 weeks',
  },
  {
    name: 'Neck & shoulder stiffness',
    description:
      'Targeted mobilisation of the cervical spine and shoulder girdle, paired with massage to loosen the surrounding muscle.',
    averageSessions: '4-6 sessions (roughly 6-9 hours) over 3-4 weeks',
  },
  {
    name: 'Postural strain (desk-related)',
    description:
      'Progressive correction of spinal alignment alongside practical guidance on desk setup and everyday sitting posture.',
    averageSessions: '6-10 sessions (roughly 9-15 hours) over 6-8 weeks, plus an occasional maintenance visit',
  },
  {
    name: 'Joint misalignment',
    description:
      'Direct bone-setting to restore correct joint position, followed by supporting soft-tissue work to help the joint hold its new position.',
    averageSessions: '4-8 sessions (roughly 6-12 hours), depending on the joint and how long it has been misaligned',
  },
  {
    name: 'Sports & activity injuries',
    description:
      'Manipulation and massage focused on the injured joint or muscle group, sequenced around training or competition schedules.',
    averageSessions: '4-6 sessions (roughly 6-9 hours), timed around activity load',
  },
  {
    name: 'Sciatica-type discomfort',
    description:
      "Manipulation to relieve pressure along the nerve's path, combined with massage to ease the surrounding muscle tension that often accompanies it.",
    averageSessions: '6-10 sessions (roughly 9-15 hours) over 6-8 weeks',
  },
  {
    name: 'Frozen shoulder',
    description:
      "Gradual mobilisation of the shoulder joint to restore range of motion, paced to the joint's current stage of stiffness.",
    averageSessions:
      '8-12 sessions (roughly 12-18 hours) over 2-3 months - usually the slowest-resolving of these conditions',
  },
  {
    name: 'Sprains & minor dislocations',
    description:
      'Manual reduction and realignment of the affected joint, followed by supportive taping or bracing guidance while it stabilises.',
    averageSessions: '2-4 sessions (roughly 3-6 hours) for straightforward cases',
  },
  {
    name: 'Chronic tension & stress-holding',
    description:
      'Full-body massage and manipulation aimed at the muscle groups where stress is most commonly held, alongside broader circulation work.',
    averageSessions: 'An initial course of 6 sessions (roughly 9 hours), then periodic maintenance visits',
  },
];

async function isEmpty(db: Queryable, table: 'session_types' | 'faq_entries' | 'ailments' | 'terms_versions'): Promise<boolean> {
  // Table name comes from the fixed union above, never from input.
  const { rowCount } = await db.query(`SELECT 1 FROM ${table} LIMIT 1`);
  return rowCount === 0;
}

export async function seedDefaultSessionType(db: Queryable, report: SeedReport): Promise<void> {
  if (!(await isEmpty(db, 'session_types'))) {
    report.skipped('default session type', 'session types already exist');
    return;
  }
  const t = DEFAULT_SESSION_TYPE;
  await db.query(
    'INSERT INTO session_types (name, duration_minutes, rate_lkr_minor, rate_usd_minor) VALUES ($1, $2, $3, $4)',
    [t.name, t.durationMinutes, t.rateLkrMinor, t.rateUsdMinor],
  );
  report.created(
    'default session type',
    `${t.name}, ${t.durationMinutes} min, LKR ${(t.rateLkrMinor / 100).toFixed(2)} / USD ${(t.rateUsdMinor / 100).toFixed(2)}`,
  );
}

export async function seedFaqs(db: Queryable, report: SeedReport): Promise<void> {
  if (!(await isEmpty(db, 'faq_entries'))) {
    report.skipped('FAQs', 'FAQ entries already exist');
    return;
  }
  await db.query(
    `INSERT INTO faq_entries (question, answer, proactively_highlight, display_order)
     SELECT q, a, h, o FROM unnest($1::text[], $2::text[], $3::boolean[], $4::int[]) AS t(q, a, h, o)`,
    [FAQS.map((f) => f.question), FAQS.map((f) => f.answer), FAQS.map((f) => f.highlight), FAQS.map((_, i) => i + 1)],
  );
  report.created('FAQs', `${FAQS.length} entries`);
}

export async function seedAilments(db: Queryable, report: SeedReport): Promise<void> {
  if (!(await isEmpty(db, 'ailments'))) {
    report.skipped('ailments', 'ailments already exist');
    return;
  }
  await db.query(
    `INSERT INTO ailments (name, description, average_sessions, display_order)
     SELECT n, d, s, o FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS t(n, d, s, o)`,
    [
      AILMENTS.map((a) => a.name),
      AILMENTS.map((a) => a.description),
      AILMENTS.map((a) => a.averageSessions),
      AILMENTS.map((_, i) => i + 1),
    ],
  );
  report.created('ailments', `${AILMENTS.length} entries, no anatomy segments assigned`);
}

/**
 * The old app's starter general terms (its terms.service.js), as the first draft. The refund
 * policy section starts empty: the owner writes it before the first publish.
 */
const STARTER_GENERAL_TERMS = `AI Assistant
The Remedist provides an AI-powered chat assistant on our website to answer general questions about our services, treatment approach, and frequently asked questions, including information about pro-bono and reduced-fee options.

The AI Assistant does not diagnose conditions, assess symptoms, or provide medical advice of any kind. Where it recommends you consult Rauzan Aly directly or seek independent medical advice, that recommendation should be followed rather than treated as optional.

Responses are generated automatically and, while drawn from information maintained by The Remedist, may occasionally be incomplete, outdated, or inaccurate. They do not constitute a binding quote, guarantee, medical opinion, or formal advice from The Remedist or Rauzan Aly.

Conversations with the AI Assistant are not stored or retained by The Remedist, except where you choose to rate a response. If you rate a response while not logged in, that rating is stored without identifying you. If you rate a response while logged in, that rating is stored together with your Client Registration Number for internal review. You are welcome to use the AI Assistant while logged out if you prefer ratings not to be linked to your account.

The AI Assistant currently operates in English only, does not provide pricing information, and is provided as a convenience feature that The Remedist may modify, restrict, suspend, or discontinue at any time.

Internal tools
We may use AI tools internally to help manage records, generate summaries, and support clinic operations.`;

export async function seedTermsDraft(db: Queryable, report: SeedReport): Promise<void> {
  if (!(await isEmpty(db, 'terms_versions'))) {
    report.skipped('terms draft', 'terms already exist');
    return;
  }
  await db.query(
    `INSERT INTO terms_versions (status, general_terms_content, refund_policy_content) VALUES ('draft', $1, '')`,
    [STARTER_GENERAL_TERMS],
  );
  report.created('terms draft', 'starter general terms, refund policy to write');
}
