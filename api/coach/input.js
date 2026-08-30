/* Normalise user-controlled Coach inputs before they enter a queued, billable job. */

const GOALS = new Set(['strength', 'muscle', 'general', 'fatloss', 'endurance']);
const EXPERIENCE = new Set(['new', 'returning', 'regular']);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function intakeOf(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('intake must be an object');
  const goal = text(value.goal, 30);
  const experience = text(value.experience, 30);
  if (goal && !GOALS.has(goal)) throw new Error('unknown training goal');
  if (experience && !EXPERIENCE.has(experience)) throw new Error('unknown experience level');

  const daysPerWeek = Number(value.daysPerWeek);
  const sessionMin = Number(value.sessionMin);
  const preferredDays = Array.isArray(value.preferredDays)
    ? [...new Set(value.preferredDays.filter(Number.isInteger).filter(d => d >= 0 && d <= 6))].slice(0, 7)
    : [];
  const equipment = Array.isArray(value.equipment)
    ? [...new Set(value.equipment.filter(v => typeof v === 'string').map(v => text(v, 40)).filter(Boolean))].slice(0, 20)
    : [];

  return {
    goal: goal || null,
    experience: experience || null,
    daysPerWeek: Number.isInteger(daysPerWeek) && daysPerWeek >= 1 && daysPerWeek <= 7 ? daysPerWeek : null,
    preferredDays,
    sessionMin: Number.isInteger(sessionMin) && sessionMin >= 10 && sessionMin <= 240 ? sessionMin : null,
    equipment,
    limitations: text(value.limitations, 600),
    likes: text(value.likes, 300),
    dislikes: text(value.dislikes, 300),
    notes: text(value.notes, 600)
  };
}
