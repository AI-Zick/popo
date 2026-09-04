/**
 * The demo's routes.
 *
 * A second copy of the server's route wiring, and the only part of this demo
 * that is a second copy of anything: the rules underneath — validation,
 * permissions, review, custody chains, retention manifests — are imported from
 * `src/domain`, exactly as the real server imports them.
 *
 * Anything not implemented here answers with a plain sentence saying so rather
 * than failing in a way that looks like a bug in the product.
 */

import { can, createUser, sanitizeUserInput, type Permission } from '@/domain/auth';
import { canReopen, canReview, canSubmit } from '@/domain/review';
import { checkArrest, blockingProblems as arrestBlocking, createArrest, createCharge, nextArrestNumber } from '@/domain/arrest';
import { createTask, sortTasks } from '@/domain/caseTask';
import { canDecide, canRequestRemoval, photosFor } from '@/domain/photo';
import { displayName } from '@/domain/person';
import {
  CONFIRMATION_NOTICE,
  checkAttempt,
  checkRecall,
  sortWarrants,
  warrantState,
  type ServiceAttempt,
  type Warrant,
} from '@/domain/warrant';
import {
  DEFAULT_RETENTION_YEARS,
  NOT_EVIDENCE,
  adviseContact,
  checkContact,
  createFieldContact,
  createSubject,
  nextContactNumber,
  sortContacts,
  type FieldContact,
} from '@/domain/fieldContact';
import {
  checkLift,
  checkTrespass,
  createTrespass,
  existingFor,
  isActive,
  sortForPerson,
  today,
  trespassState,
  type Trespass,
} from '@/domain/trespass';
import {
  createMasterVehicle,
  isIdentifiable,
  vehicleName,
  vinCheckDigit,
} from '@/domain/vehicle';
import {
  autoLinkVehicle,
  findVehicleMatches,
  mergeObservation,
  type VehicleQuery,
} from '@/domain/vehicleMatching';

/** The fields the vehicle routes read, trimmed the way the server trims them. */
const vehicleQuery = (input: Record<string, unknown>): VehicleQuery => ({
  vin: text(input.vin, 32).trim(),
  plate: text(input.plate, 16).trim(),
  plateState: text(input.plateState, 2).trim(),
  year: text(input.year, 4).trim(),
  make: text(input.make, 40).trim(),
  model: text(input.model, 40).trim(),
  color: text(input.color, 30).trim(),
});
import {
  appendCustody, canRecord, checkItem, custodyState, findingsFor, nextTagNumber, verifyCustody,
  type CustodyAction, type EvidenceItem,
} from '@/domain/evidence';
import {
  blockingProblems as fleetBlocking, checkCheck, checkRequest, createCheck,
  createCruiser, createRequest, criticalFailures, nextRequestNumber, takesOffRoad,
  type CheckedItem, type MaintenanceRequest,
} from '@/domain/fleet';
import {
  blockingProblems as orderBlocking, canExecute, certificateFor, checkOrder, createOrder,
  needsTwoPeople, nextOrderReference, type DisposalOrder, type ManifestLine,
} from '@/domain/retention';
import { isRedacted, redactEntry, verifyChain } from '@/domain/audit';
import { createSupplement, nextNumber } from '@/domain/supplement';
import { createCrashReport } from '@/domain/crash';
import { audit, currentUser, db, newId, password, reset, seedHistory } from './store';

export interface Reply {
  status: number;
  body: unknown;
}

const ok = (body: unknown = { ok: true }): Reply => ({ status: 200, body });
const fail = (status: number, error: string): Reply => ({ status, body: { error } });
const text = (v: unknown, max: number) => String(v ?? '').slice(0, max);
const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(text(v, 10)) ? text(v, 10) : '');

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;
}

const need = (permission: Permission): Reply | null =>
  can(currentUser(), permission) ? null : fail(403, 'You do not have permission to do that.');

/* ------------------------------------------------------------------ */

export async function handle(method: string, url: string, body: unknown): Promise<Reply> {
  // Hashing is async, so the starting history cannot be built in `fresh()`.
  await seedHistory();
  const [path, queryString] = url.split('?');
  const query = new URLSearchParams(queryString ?? '');
  const parts = path.replace(/^\/api\//, '').split('/');
  const input = (body ?? {}) as Record<string, unknown>;
  const state = db();
  const user = currentUser();

  const at = () => new Date().toISOString();

  switch (parts[0]) {
    /* ---- Auth ----------------------------------------------------- */
    case 'auth': {
      if (parts[1] === 'me') return ok({ user, mustChangePassword: false });
      if (parts[1] === 'mfa') {
        // The status reads as a real one so the screen renders; anything that
        // would need a phone says why it cannot.
        if (method === 'GET') {
          return ok({ enrolled: false, pending: false, confirmedAt: '', recoveryRemaining: 0, required: false });
        }
        return fail(400, 'The demo signs you straight in — a shared link has no phone to enrol, so there is nothing to set up here.');
      }
      if (parts[1] === 'sign-in') {
        const username = text(input.username, 60).toLowerCase();
        const found = state.users.find((u) => u.username === username && u.active);
        if (!found || text(input.password, 200) !== password) {
          return fail(401, 'That username and password do not match.');
        }
        state.currentUserId = found.id;
        await audit({ actorId: found.id, actorName: found.name, action: 'auth.signIn', target: '', detail: found.role });
        return ok({ user: found, mustChangePassword: false });
      }
      if (parts[1] === 'sign-out') return ok();
      if (parts[1] === 'password') {
        return fail(400, 'Passwords cannot be changed in the demo — everyone shares one.');
      }
      return fail(404, 'Not found.');
    }

    /* ---- Everything the client renders from ------------------------ */
    case 'state': {
      const sealed = new Set(state.seals.map((s) => s.subjectId));
      const maySeeSealed = can(user, 'records.seal');
      const hidden = (id: string, caseId = '') => sealed.has(id) || sealed.has(caseId);
      return ok({
        incidents: state.incidents.filter((i) => !hidden(i.id)),
        supplements: state.supplements.filter((s) => !hidden(s.id, s.caseId)),
        stops: state.stops,
        crashes: state.crashes.filter((c) => !hidden(c.id)),
        returns: state.returns,
        arrests: state.arrests.filter((a) => !hidden(a.id, a.caseId)),
        caseTasks: state.caseTasks.filter((t) => !hidden(t.id, t.caseId)),
        photos: state.photos.filter((p) => !hidden(p.masterId)),
        seals: maySeeSealed ? state.seals : [],
        people: state.people,
        locations: state.locations,
        vehicles: state.vehicles,
        wanted: Object.fromEntries(
          Object.entries(
            state.warrants
              .filter((w) => warrantState(w) === 'active')
              .reduce<Record<string, { count: number; national: boolean }>>((acc, w) => {
                const entry = acc[w.personId] ?? { count: 0, national: false };
                entry.count += 1;
                entry.national = entry.national || w.extradition === 'national';
                acc[w.personId] = entry;
                return acc;
              }, {}),
          ),
        ),
        versions: {},
        locks: state.locks,
        attachments: state.attachments,
        agency: state.agency,
        users: state.users,
        auditLog: can(user, 'audit.view') ? state.auditLog : [],
      });
    }

    case 'agency': {
      const denied = need('agency.configure');
      if (denied) return denied;
      state.agency = { ...state.agency, ...(input.agency as object) };
      await audit({ actorId: user.id, actorName: user.name, action: 'agency.configured', target: state.agency.name, detail: '' });
      return ok();
    }

    /* ---- Documents ------------------------------------------------- */
    case 'records': {
      const collection = parts[1] as keyof typeof COLLECTIONS;
      const list = COLLECTIONS[collection];
      if (!list) return fail(404, 'Unknown collection.');
      const rows = list();
      const id = parts[2];
      if (method === 'DELETE') {
        const index = rows.findIndex((r) => r.id === id);
        if (index >= 0) rows.splice(index, 1);
        return ok();
      }
      if (method === 'PUT') {
        const doc = input.doc as { id: string } | undefined;
        if (!doc) return fail(400, 'Nothing to save.');
        const index = rows.findIndex((r) => r.id === id);
        if (index >= 0) rows[index] = doc as never;
        else rows.push(doc as never);
        return ok({ ok: true, version: 1 });
      }
      const found = rows.find((r) => r.id === id);
      return found ? ok({ doc: found, version: 1 }) : fail(404, 'No such record.');
    }

    case 'locks': {
      if (method === 'GET') return ok({ locks: state.locks });
      const id = parts[1];
      if (method === 'DELETE') {
        delete state.locks[id];
        return ok();
      }
      state.locks[id] = { userId: user.id, userName: user.name, acquiredAt: at() };
      return ok({ ok: true, tookOver: false });
    }

    /* ---- Review ---------------------------------------------------- */
    case 'reports': {
      const incident = state.incidents.find((i) => i.id === parts[1]);
      if (!incident) return fail(404, 'No such report.');
      const action = parts[2];
      const note = text(input.note ?? input.reason, 1000);

      if (action === 'submit') {
        const allowed = canSubmit(incident.status);
        if (!allowed.ok) return fail(403, allowed.reason!);
        Object.assign(incident, { status: 'pending_review', submittedAt: at() });
        await audit({ actorId: user.id, actorName: user.name, action: 'report.submitted', target: incident.caseNumber, detail: '' });
        return ok({ ok: true, report: incident });
      }
      if (action === 'approve' || action === 'return') {
        const allowed = canReview(user, incident);
        if (!allowed.ok) return fail(403, allowed.reason!);
        if (action === 'return' && !note.trim()) return fail(400, 'Say what needs fixing.');
        Object.assign(incident, {
          status: action === 'approve' ? 'approved' : 'returned',
          reviewedBy: user.name,
          reviewedAt: at(),
          returnedReason: action === 'return' ? note : '',
        });
        await audit({ actorId: user.id, actorName: user.name, action: action === 'approve' ? 'report.approved' : 'report.returned', target: incident.caseNumber, detail: note });
        return ok({ ok: true, report: incident });
      }
      if (action === 'reopen') {
        const allowed = canReopen(user, incident.status);
        if (!allowed.ok) return fail(403, allowed.reason!);
        if (!note.trim()) return fail(400, 'Say why it is being reopened.');
        Object.assign(incident, { status: 'draft' });
        await audit({ actorId: user.id, actorName: user.name, action: 'report.reopened', target: incident.caseNumber, detail: note });
        return ok({ ok: true, report: incident });
      }
      if (action === 'comments') {
        const comments = incident.reviewComments ?? [];
        const comment = comments.find((c) => c.id === parts[3]);
        if (comment) Object.assign(comment, { resolvedAt: at(), resolvedBy: user.name });
        return ok({ ok: true, report: incident });
      }
      return fail(404, 'Not found.');
    }

    /* ---- Arrests ---------------------------------------------------- */
    case 'arrests': {
      if (method === 'GET' && !parts[1]) return ok({ arrests: state.arrests });
      if (method === 'POST' && !parts[1]) {
        const caseId = text(input.caseId, 64);
        const incident = state.incidents.find((i) => i.id === caseId);
        const masterId = text(input.masterId, 64);
        const person = state.people[masterId];
        const arrest = createArrest({
          id: newId('arr'),
          arrestNumber: nextArrestNumber(state.arrests.map((a) => a.arrestNumber)),
          caseId,
          caseNumber: incident?.caseNumber ?? '',
          masterId,
          personName: person ? [person.lastName, person.firstName].filter(Boolean).join(', ') : '',
          arrestingOfficerId: user.id,
          arrestingOfficerName: user.name,
          createdBy: user.id,
        });
        state.arrests.push(arrest);
        await audit({ actorId: user.id, actorName: user.name, action: 'arrest.created', target: arrest.arrestNumber, detail: arrest.caseNumber });
        return ok({ arrest });
      }

      const arrest = state.arrests.find((a) => a.id === parts[1]);
      if (!arrest) return fail(404, 'No such arrest.');
      const incident = state.incidents.find((i) => i.id === arrest.caseId);

      if (method === 'PUT') {
        if (arrest.status === 'approved') return fail(409, 'This arrest has been approved. Reopen it to change anything.');
        const charges = Array.isArray(input.charges)
          ? (input.charges as Record<string, unknown>[]).map((c, i) =>
              createCharge({
                id: text(c.id, 64) || newId(`chg${i}`),
                statute: text(c.statute, 60),
                description: text(c.description, 300),
                severity: oneOf(c.severity, ['', 'felony', 'misdemeanor', 'ordinance', 'infraction'] as const, ''),
                degree: text(c.degree, 20),
                counts: text(c.counts, 4) || '1',
                nibrsCode: text(c.nibrsCode, 10),
                bondAmount: text(c.bondAmount, 30),
                outcome: oneOf(c.outcome, ['', 'pending', 'convicted', 'acquitted', 'dismissed', 'notProsecuted', 'diverted', 'reduced'] as const, ''),
                outcomeAt: text(c.outcomeAt, 30),
                outcomeNote: text(c.outcomeNote, 300),
              }),
            )
          : arrest.charges;
        Object.assign(arrest, input, { charges, id: arrest.id, status: arrest.status, updatedAt: at() });
        return ok({ arrest, problems: checkArrest(arrest, { incidentReportedAt: incident?.reportedAt }) });
      }

      const action = parts[2];
      const note = text(input.note ?? input.reason, 1000);
      const problems = checkArrest(arrest, { incidentReportedAt: incident?.reportedAt });

      if (action === 'submit') {
        const allowed = canSubmit(arrest.status);
        if (!allowed.ok) return fail(403, allowed.reason!);
        const blocking = arrestBlocking(problems);
        if (blocking.length > 0) {
          return fail(400, `${blocking.length} ${blocking.length === 1 ? 'problem' : 'problems'} to fix first.`);
        }
        arrest.status = 'pending_review';
        arrest.reviewHistory.push({ id: newId('rev'), action: 'submitted', actorId: user.id, actorName: user.name, at: at(), note: '' });
      } else if (action === 'approve' || action === 'return') {
        const allowed = canReview(user, { status: arrest.status, createdBy: arrest.createdBy, reportingOfficer: arrest.arrestingOfficerId });
        if (!allowed.ok) return fail(403, allowed.reason!);
        if (action === 'return' && !note.trim()) return fail(400, 'Say what needs fixing.');
        arrest.status = action === 'approve' ? 'approved' : 'returned';
        arrest.reviewHistory.push({ id: newId('rev'), action: action === 'approve' ? 'approved' : 'returned', actorId: user.id, actorName: user.name, at: at(), note });
      } else if (action === 'reopen') {
        const allowed = canReopen(user, arrest.status);
        if (!allowed.ok) return fail(403, allowed.reason!);
        if (!note.trim()) return fail(400, 'Say why it is being reopened.');
        arrest.status = 'draft';
        arrest.reviewHistory.push({ id: newId('rev'), action: 'reopened', actorId: user.id, actorName: user.name, at: at(), note });
      } else {
        return fail(400, 'Unknown action.');
      }

      arrest.updatedAt = at();
      await audit({
        actorId: user.id, actorName: user.name,
        action: `arrest.${action === 'return' ? 'returned' : action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'reopened'}` as never,
        target: arrest.arrestNumber, detail: note,
      });
      return ok({ arrest, problems: checkArrest(arrest, { incidentReportedAt: incident?.reportedAt }) });
    }

    /* ---- Case to-do -------------------------------------------------- */
    case 'cases': {
      const caseId = parts[1];
      if (method === 'GET') return ok({ tasks: sortTasks(state.caseTasks.filter((t) => t.caseId === caseId)) });
      const what = text(input.text, 500).trim();
      if (!what) return fail(400, 'Say what needs doing.');
      const assignedToId = text(input.assignedToId, 64);
      const task = createTask({
        id: newId('tsk'), caseId, text: what, assignedToId,
        assignedToName: state.users.find((u) => u.id === assignedToId)?.name ?? '',
        dueOn: day(input.dueOn), createdBy: user.id, createdByName: user.name,
      });
      state.caseTasks.push(task);
      return ok({ task });
    }

    case 'tasks': {
      const task = state.caseTasks.find((t) => t.id === parts[1]);
      if (!task) return fail(404, 'No such item.');
      if (method === 'DELETE') {
        if (task.createdBy !== user.id && !can(user, 'reports.approve')) {
          return fail(403, 'Only the person who added this, or a supervisor, can remove it. Tick it off instead.');
        }
        state.caseTasks.splice(state.caseTasks.indexOf(task), 1);
        return ok();
      }
      const done = input.done === undefined ? task.done : Boolean(input.done);
      Object.assign(task, {
        text: input.text === undefined ? task.text : text(input.text, 500).trim() || task.text,
        dueOn: input.dueOn === undefined ? task.dueOn : day(input.dueOn),
        done,
        doneAt: done ? (task.done ? task.doneAt : at()) : '',
        doneByName: done ? (task.done ? task.doneByName : user.name) : '',
        updatedAt: at(),
      });
      return ok({ task });
    }

    /* ---- Photographs -------------------------------------------------- */
    case 'people': {
      const masterId = parts[1];
      if (parts[2] === 'warrants') {
        const mine = state.warrants.filter((w) => w.personId === masterId);
        return ok({
          warrants: sortWarrants(mine).map((warrant: Warrant) => ({
            warrant,
            state: warrantState(warrant),
          })),
          notice: CONFIRMATION_NOTICE,
        });
      }
      if (parts[2] === 'contacts') {
        const all = state.contacts.filter((c) =>
          c.subjects.some((sub) => sub.masterId === masterId),
        );
        const seeAll = can(user, 'audit.view') || can(user, 'reports.approve');
        const visible = seeAll ? all : all.filter((c) => c.officerId === user.id);
        return ok({
          contacts: sortContacts(visible),
          hidden: all.length - visible.length,
          retentionYears: DEFAULT_RETENTION_YEARS,
          notice: NOT_EVIDENCE,
        });
      }
      if (parts[2] === 'trespasses') {
        const mine = state.trespasses.filter((t) => t.personId === masterId);
        return ok({
          trespasses: sortForPerson(mine).map((trespass: Trespass) => ({
            trespass,
            location: state.locations[trespass.locationId] ?? null,
            state: trespassState(trespass),
          })),
        });
      }
      if (method === 'GET') return ok({ photos: photosFor(state.photos, masterId) });
      return fail(400, 'Use the Add button — uploads go through a different path in the demo.');
    }

    case 'photos': {
      const photo = state.photos.find((p) => p.id === parts[1]);
      if (!photo) return fail(404, 'No such photograph.');
      if (parts[2] === 'request-removal') {
        const allowed = canRequestRemoval(photo);
        if (!allowed.ok) return fail(409, allowed.reason!);
        const reason = text(input.reason, 500).trim();
        if (!reason) return fail(400, 'Say what is wrong with it. "Wrong photo" gives whoever decides nothing to go on.');
        Object.assign(photo, {
          removal: 'requested', requestedBy: user.id, requestedByName: user.name,
          requestedAt: at(), requestReason: reason, decidedByName: '', decidedAt: '', decisionNote: '',
        });
        await audit({ actorId: user.id, actorName: user.name, action: 'photo.removalRequested', target: photo.masterId, detail: reason });
        return ok({ photo });
      }
      if (parts[2] === 'decide') {
        const denied = need('notes.retract');
        if (denied) return fail(403, 'Taking a photograph off a record needs the same authority as withdrawing a note.');
        const allowed = canDecide(photo);
        if (!allowed.ok) return fail(409, allowed.reason!);
        const remove = Boolean(input.remove);
        const note = text(input.note, 500).trim();
        if (!remove && !note) return fail(400, 'Say why it is staying up. The person who asked will see it.');
        Object.assign(photo, { removal: remove ? 'removed' : 'kept', decidedByName: user.name, decidedAt: at(), decisionNote: note });
        await audit({ actorId: user.id, actorName: user.name, action: remove ? 'photo.removed' : 'photo.kept', target: photo.masterId, detail: note || photo.requestReason });
        return ok({ photo });
      }
      return fail(404, 'Not found.');
    }

    /* ---- Audit ------------------------------------------------------- */
    case 'audit': {
      const denied = need('audit.view');
      if (denied) return denied;
      if (parts[1] === 'verify') return ok(await verifyChain(state.auditLog));
      return ok({ entries: state.auditLog });
    }

    /* ---- Accounts ------------------------------------------------------ */
    case 'users': {
      const denied = need('users.manage');
      if (denied) return denied;
      if (parts[2] === 'mfa') {
        return fail(400, 'The demo has no second factor to clear — there is no phone behind a shared link. On a real installation this ends their sessions and makes them enrol again.');
      }
      if (parts[2] === 'deactivate' || parts[2] === 'reactivate') {
        const target = state.users.find((u) => u.id === parts[1]);
        if (!target) return fail(404, 'No such account.');
        target.active = parts[2] === 'reactivate';
        await audit({ actorId: user.id, actorName: user.name, action: target.active ? 'user.reactivated' : 'user.deactivated', target: target.name, detail: '' });
        return ok({ user: target });
      }
      const safe = sanitizeUserInput(user, input);
      const created = createUser({ ...safe, id: newId('usr') } as never);
      state.users.push(created);
      await audit({ actorId: user.id, actorName: user.name, action: 'user.created', target: created.name, detail: created.role });
      return ok({ user: created, temporaryPassword: password });
    }

    /* ---- Trespass notices ----------------------------------------------- */
    /*
      The same filtering, ordering and paging the server does in SQL, done here
      over an array. It is the same contract because it is the same screen: a
      demo whose list behaves differently teaches the wrong thing about how the
      real one behaves.
    */
    case 'locations': {
      if (parts[2] !== 'trespasses') return fail(404, 'Not found.');
      const locationId = parts[1];
      const search = text(query.get('q'), 80).trim().toUpperCase();
      const showAll = query.get('state') === 'all';
      const direction = query.get('dir') === 'desc' ? -1 : 1;
      const sort = text(query.get('sort'), 20) || 'name';
      const limit = Math.min(Math.max(Number(query.get('limit')) || 50, 1), 200);
      const offset = Math.max(Number(query.get('offset')) || 0, 0);
      const on = today();

      const here = state.trespasses.filter((t) => t.locationId === locationId);
      const active = here.filter((t) => isActive(t, on)).length;

      const named = here.map((trespass) => ({
        trespass,
        person: state.people[trespass.personId] ?? null,
      }));
      const matching = named.filter(({ trespass, person }) => {
        if (!showAll && !isActive(trespass, on)) return false;
        if (!search) return true;
        const last = (person?.lastName ?? '').toUpperCase();
        const first = (person?.firstName ?? '').toUpperCase();
        return last.startsWith(search) || first.startsWith(search) || (person?.dob ?? '').startsWith(search);
      });

      matching.sort((a, b) => {
        if (sort === 'served') {
          return direction * a.trespass.servedOn.localeCompare(b.trespass.servedOn);
        }
        if (sort === 'expires') {
          // An indefinite notice has no date to sort by, so it goes last
          // rather than appearing to have run out in the year zero.
          const left = a.trespass.expiresOn || '\uffff';
          const right = b.trespass.expiresOn || '\uffff';
          return direction * left.localeCompare(right);
        }
        const byLast = (a.person?.lastName ?? '').localeCompare(b.person?.lastName ?? '');
        if (byLast !== 0) return direction * byLast;
        return direction * (a.person?.firstName ?? '').localeCompare(b.person?.firstName ?? '');
      });

      return ok({
        total: matching.length,
        active,
        limit,
        offset,
        rows: matching.slice(offset, offset + limit).map(({ trespass, person }) => ({
          trespass,
          person: person
            ? { id: person.id, name: displayName(person), dob: person.dob, cautions: person.cautions }
            : null,
          state: trespassState(trespass, on),
        })),
      });
    }

    case 'trespasses': {
      if (method === 'POST' && !parts[1]) {
        const draft = {
          personId: text(input.personId, 64),
          locationId: text(input.locationId, 64),
          servedOn: text(input.servedOn, 10),
          expiresOn: text(input.expiresOn, 10),
          requestedBy: text(input.requestedBy, 120).trim(),
          requestedByPhone: text(input.requestedByPhone, 40).trim(),
          caseNumber: text(input.caseNumber, 40).trim(),
          notes: text(input.notes, 2000).trim(),
          source: (text(input.source, 20) || 'officer') as 'officer' | 'dispatch',
        };
        const check = checkTrespass(draft);
        if (!check.ok) return fail(400, check.reason);
        if (!state.people[draft.personId]) return fail(404, 'No such person on file.');
        const place = state.locations[draft.locationId];
        if (!place) return fail(404, 'No such location on file.');

        const renewalOf = existingFor(state.trespasses, draft.personId, draft.locationId);
        const trespass = createTrespass({
          ...draft,
          id: newId('tr'),
          issuedById: user.id,
          issuedByName: user.name,
        });
        state.trespasses.push(trespass);
        await audit({
          actorId: user.id,
          actorName: user.name,
          action: 'trespass.recorded',
          target: place.commonName || place.address,
          detail: draft.expiresOn ? `Until ${draft.expiresOn}` : 'No end date',
        });
        return { status: 201, body: { trespass, renewalOf } };
      }

      const trespass = state.trespasses.find((t) => t.id === parts[1]);
      if (!trespass) return fail(404, 'No such notice.');

      if (parts[2] === 'lift') {
        const denied = need('trespass.lift');
        if (denied) return denied;
        if (trespass.liftedAt) return fail(409, 'That notice has already been lifted.');
        const reason = text(input.reason, 500).trim();
        const check = checkLift(reason);
        if (!check.ok) return fail(400, check.reason);
        Object.assign(trespass, {
          liftedAt: at(),
          liftedBy: user.name,
          liftReason: reason,
          updatedAt: at(),
        });
        const place = state.locations[trespass.locationId];
        await audit({
          actorId: user.id,
          actorName: user.name,
          action: 'trespass.lifted',
          target: place?.commonName || place?.address || trespass.locationId,
          detail: reason,
        });
        return ok({ trespass });
      }
      return fail(404, 'Not found.');
    }

    /* ---- Warrants --------------------------------------------------------- */
    case 'warrants': {
      if (method === 'GET' && !parts[1]) {
        const showAll = query.get('state') === 'all';
        const rows = state.warrants.filter((w) => showAll || warrantState(w) === 'active');
        return ok({
          total: rows.length,
          outstanding: state.warrants.filter((w) => warrantState(w) === 'active').length,
          limit: 50,
          offset: 0,
          notice: CONFIRMATION_NOTICE,
          rows: rows.map((warrant) => {
            const person = state.people[warrant.personId];
            return {
              warrant,
              person: person
                ? { id: person.id, name: displayName(person), dob: person.dob, cautions: person.cautions }
                : null,
              state: warrantState(warrant),
            };
          }),
        });
      }

      const warrant = state.warrants.find((w) => w.id === parts[1]);

      if (method === 'POST' && !parts[1]) {
        return fail(400, 'Entering a warrant needs the court paperwork in front of you — not something the demo can stand in for.');
      }
      if (!warrant) return fail(404, 'No such warrant.');

      if (parts[2] === 'attempts') {
        if (warrantState(warrant) !== 'active') {
          return fail(409, 'That warrant is no longer outstanding, so there is nothing to serve.');
        }
        const attempt = {
          id: newId('att'),
          at: at(),
          address: text(input.address, 200).trim(),
          byId: user.id,
          byName: user.name,
          outcome: text(input.outcome, 20) as ServiceAttempt['outcome'],
          notes: text(input.notes, 1000).trim(),
        };
        const check = checkAttempt(attempt);
        if (!check.ok) return fail(400, check.reason);
        warrant.attempts = [...warrant.attempts, attempt];
        if (attempt.outcome === 'served') {
          warrant.servedOn = at().slice(0, 10);
          warrant.servedByName = user.name;
        }
        warrant.updatedAt = at();
        await audit({
          actorId: user.id,
          actorName: user.name,
          action: attempt.outcome === 'served' ? 'warrant.served' : 'warrant.attempted',
          target: warrant.number,
          detail: attempt.outcome,
        });
        return ok({ warrant });
      }

      if (parts[2] === 'recall') {
        const denied = need('notes.retract');
        if (denied) return fail(403, 'Taking a warrant out of circulation needs the same authority as withdrawing a note.');
        if (warrant.recalledOn) return fail(409, 'That warrant has already been recalled.');
        if (warrant.servedOn) return fail(409, 'That warrant was served. A served warrant is not recalled.');
        const reason = text(input.reason, 500).trim();
        const check = checkRecall(reason);
        if (!check.ok) return fail(400, check.reason);
        warrant.recalledOn = at().slice(0, 10);
        warrant.recalledReason = reason;
        warrant.updatedAt = at();
        await audit({
          actorId: user.id,
          actorName: user.name,
          action: 'warrant.recalled',
          target: warrant.number,
          detail: reason,
        });
        return ok({ warrant });
      }
      return fail(404, 'Not found.');
    }

    /* ---- Field contacts ---------------------------------------------------- */
    case 'contacts': {
      if (method === 'GET') {
        const mine = query.get('scope') !== 'all';
        const seeAll = can(user, 'audit.view') || can(user, 'reports.approve');
        if (!mine && !seeAll) {
          return fail(403, 'Reading everybody’s field contacts is a supervisor and records function.');
        }
        const list = mine ? state.contacts.filter((c) => c.officerId === user.id) : state.contacts;
        return ok({
          contacts: sortContacts(list),
          retentionYears: DEFAULT_RETENTION_YEARS,
          notice: NOT_EVIDENCE,
        });
      }

      if (method === 'POST' && !parts[1]) {
        const draft = {
          occurredAt: text(input.occurredAt, 40).trim(),
          locationId: text(input.locationId, 64),
          address: text(input.address, 200).trim(),
          basis: text(input.basis, 20) as FieldContact['basis'],
          reason: text(input.reason, 2000).trim(),
          subjects: (Array.isArray(input.subjects) ? input.subjects : []).slice(0, 12).map((raw: Record<string, unknown>) =>
            createSubject({
              id: newId('sub'),
              masterId: text(raw?.masterId, 64),
              givenName: text(raw?.givenName, 120).trim(),
              description: text(raw?.description, 500).trim(),
              declinedToIdentify: Boolean(raw?.declinedToIdentify),
            }),
          ),
          disposition: text(input.disposition, 20) as FieldContact['disposition'],
          narrative: text(input.narrative, 20000).trim(),
          caseNumber: text(input.caseNumber, 40).trim(),
        };
        const check = checkContact(draft);
        if (!check.ok) return fail(400, check.reason);
        const contact = createFieldContact({
          ...draft,
          id: newId('fc'),
          number: nextContactNumber(state.contacts.map((c) => c.number)),
          officerId: user.id,
          officerName: user.name,
        });
        state.contacts.push(contact);
        await audit({
          actorId: user.id,
          actorName: user.name,
          action: 'contact.recorded',
          target: contact.number,
          detail: draft.basis,
        });
        return {
          status: 201,
          body: { contact, advice: adviseContact(draft), retentionYears: DEFAULT_RETENTION_YEARS },
        };
      }
      return fail(404, 'Not found.');
    }

    /* ---- The Master Vehicle Index ---------------------------------------- */
    case 'vehicles': {
      if (method === 'GET' && !parts[1]) return ok({ vehicles: Object.values(state.vehicles) });
      if (parts[1] === 'resolve') {
        const q = vehicleQuery(input);
        const matches = findVehicleMatches(q, state.vehicles, { limit: 10 });
        return ok({ matches, autoLink: autoLinkVehicle(matches), vin: vinCheckDigit(q.vin ?? '') });
      }
      if (method === 'GET' && parts[1]) {
        const vehicle = state.vehicles[parts[1]];
        if (!vehicle) return fail(404, 'No such vehicle.');
        return ok({
          vehicle,
          registeredOwner: vehicle.registeredOwnerId
            ? (state.people[vehicle.registeredOwnerId] ?? null)
            : null,
        });
      }
      if (method === 'POST') {
        const q = vehicleQuery(input);
        if (!isIdentifiable(q)) {
          return fail(400, 'A vehicle needs a plate or a VIN. A make and a colour describes a thousand cars.');
        }
        const matches = findVehicleMatches(q, state.vehicles, { limit: 10 });
        const automatic = autoLinkVehicle(matches);
        if (automatic && !input.forceNew) {
          const merged = mergeObservation(automatic.master, q, at());
          state.vehicles[merged.id] = merged;
          return ok({ vehicle: merged, linkedToExisting: true, reasons: automatic.reasons, vin: vinCheckDigit(q.vin ?? '') });
        }
        const vehicle = createMasterVehicle({ ...q, id: newId('veh'), notes: text(input.notes, 2000).trim() });
        state.vehicles[vehicle.id] = vehicle;
        await audit({
          actorId: user.id,
          actorName: user.name,
          action: 'vehicle.created',
          target: vehicleName(vehicle),
          detail: vehicle.vin || vehicle.plate,
        });
        return {
          status: 201,
          body: {
            vehicle,
            linkedToExisting: false,
            nearMatches: matches.filter((m) => m.tier !== 'certain'),
            vin: vinCheckDigit(q.vin ?? ''),
          },
        };
      }
      return fail(404, 'Not found.');
    }

    /* ---- The fleet ------------------------------------------------------ */
    case 'fleet':
      return fleet(parts, method, input);

    /* ---- Retention ------------------------------------------------------ */
    case 'retention':
      return retention(parts, method, input, query);

    /* ---- Property and evidence ------------------------------------------ */
    case 'evidence':
      return evidence(parts, method, input);

    /* ---- Things the demo deliberately does not do ------------------------ */
    case 'extract':
      return ok({ findings: [], refused: true, enabled: false });
    case 'feedback':
      return method === 'GET'
        ? ok({ feedback: [], forwarding: false })
        : fail(400, 'The demo has nowhere to send feedback. Tell us directly instead.');
    case 'inbound':
      return ok({ returns: state.returns });
    case 'migration':
      return fail(400, 'Importing from a previous system needs a server. Not part of the demo.');
    case 'attachments':
      return method === 'GET' ? ok({ attachments: state.attachments }) : fail(400, 'Not part of the demo.');
    case 'supplements':
      return supplements(parts, method, input);
    case 'crashes':
      return crashes(parts, method, input);
    case 'stops': {
      if (method === 'GET') return ok({ stops: state.stops });
      if (method === 'DELETE') {
        const index = state.stops.findIndex((s) => s.id === parts[1]);
        if (index >= 0) state.stops.splice(index, 1);
        return ok();
      }
      const stop = input.stop as { id: string } | undefined;
      if (!stop) return fail(400, 'Nothing to save.');
      const index = state.stops.findIndex((s) => s.id === stop.id);
      if (index >= 0) state.stops[index] = stop as never;
      else state.stops.push(stop as never);
      return ok({ stop });
    }
    default:
      return fail(404, `The demo does not implement ${path}.`);
  }
}

const COLLECTIONS: Record<string, () => { id: string }[]> = {
  incidents: () => db().incidents,
  people: () => Object.values(db().people),
  locations: () => Object.values(db().locations),
};

/* ------------------------------------------------------------------ */
/* Larger areas, split out so the switch above stays readable          */
/* ------------------------------------------------------------------ */

function supplements(parts: string[], method: string, input: Record<string, unknown>): Reply {
  const state = db();
  const user = currentUser();
  if (method === 'POST' && !parts[1]) {
    const caseId = text(input.caseId, 64);
    const incident = state.incidents.find((i) => i.id === caseId);
    if (!incident) return fail(404, 'No such case.');
    const supplement = createSupplement({
      id: newId('sup'),
      caseId,
      caseNumber: incident.caseNumber,
      number: nextNumber(state.supplements, caseId),
      createdBy: user.id,
      reportingOfficer: user.name,
    });
    state.supplements.push(supplement);
    return ok({ supplement });
  }
  const supplement = state.supplements.find((s) => s.id === parts[1]);
  if (!supplement) return fail(404, 'No such supplement.');
  if (method === 'PUT') {
    Object.assign(supplement, input, { id: supplement.id, updatedAt: new Date().toISOString() });
    return ok({ supplement });
  }
  const action = parts[2];
  const note = text(input.note ?? input.reason, 1000);
  if (action === 'submit') {
    const allowed = canSubmit(supplement.status);
    if (!allowed.ok) return fail(403, allowed.reason!);
    Object.assign(supplement, { status: 'pending_review', submittedAt: new Date().toISOString() });
  } else if (action === 'approve' || action === 'return') {
    const allowed = canReview(user, supplement);
    if (!allowed.ok) return fail(403, allowed.reason!);
    if (action === 'return' && !note.trim()) return fail(400, 'Say what needs fixing.');
    Object.assign(supplement, { status: action === 'approve' ? 'approved' : 'returned', reviewedBy: user.name });
  } else if (action === 'reopen') {
    const allowed = canReopen(user, supplement.status);
    if (!allowed.ok) return fail(403, allowed.reason!);
    Object.assign(supplement, { status: 'draft' });
  }
  return ok({ supplement });
}

function crashes(parts: string[], method: string, input: Record<string, unknown>): Reply {
  const state = db();
  const user = currentUser();
  if (method === 'POST' && !parts[1]) {
    const crash = createCrashReport({
      id: newId('crs'),
      caseNumber: `2026-C${String(state.crashes.length + 1).padStart(5, '0')}`,
      callNumber: text(input.callNumber, 40),
      createdBy: user.id,
      reportingOfficer: user.name,
    });
    state.crashes.push(crash);
    return ok({ crash, prefilled: false });
  }
  const crash = state.crashes.find((c) => c.id === parts[1]);
  if (!crash) return fail(404, 'No such crash report.');
  if (method === 'PUT') {
    Object.assign(crash, input, { id: crash.id, updatedAt: new Date().toISOString() });
    return ok({ crash });
  }
  const action = parts[2];
  const note = text(input.note ?? input.reason, 1000);
  if (action === 'submit') {
    const allowed = canSubmit(crash.status);
    if (!allowed.ok) return fail(403, allowed.reason!);
    Object.assign(crash, { status: 'pending_review', submittedAt: new Date().toISOString() });
  } else if (action === 'approve' || action === 'return') {
    const allowed = canReview(user, crash);
    if (!allowed.ok) return fail(403, allowed.reason!);
    if (action === 'return' && !note.trim()) return fail(400, 'Say what needs fixing.');
    Object.assign(crash, { status: action === 'approve' ? 'approved' : 'returned', reviewedBy: user.name, returnedReason: action === 'return' ? note : '' });
  } else if (action === 'reopen') {
    const allowed = canReopen(user, crash.status);
    if (!allowed.ok) return fail(403, allowed.reason!);
    Object.assign(crash, { status: 'draft' });
  }
  return ok({ crash });
}

async function fleet(parts: string[], method: string, input: Record<string, unknown>): Promise<Reply> {
  const state = db();
  const user = currentUser();

  if (!parts[1]) {
    return ok({ cruisers: state.cruisers, checks: state.cruiserChecks, requests: state.maintenance });
  }

  if (parts[1] === 'cruisers') {
    const denied = need('agency.configure');
    if (denied) return denied;
    if (method === 'POST') {
      const unit = text(input.unit, 20).trim();
      if (!unit) return fail(400, 'A car needs a unit number — what it is called on the radio.');
      if (state.cruisers.some((c) => c.unit === unit)) return fail(409, `Unit ${unit} already exists.`);
      const cruiser = createCruiser({
        id: newId('crz'), unit,
        year: text(input.year, 4), make: text(input.make, 40), model: text(input.model, 40),
        plate: text(input.plate, 20), odometer: text(input.odometer, 10),
      });
      state.cruisers.push(cruiser);
      return ok({ cruiser });
    }
    const cruiser = state.cruisers.find((c) => c.id === parts[2]);
    if (!cruiser) return fail(404, 'No such car.');
    Object.assign(cruiser, input, { id: cruiser.id, updatedAt: new Date().toISOString() });
    return ok({ cruiser });
  }

  if (parts[1] === 'checks') {
    const cruiser = state.cruisers.find((c) => c.id === text(input.cruiserId, 64));
    if (!cruiser) return fail(404, 'No such car.');
    const template = (state.agency.checklist ?? []).filter((i) => i.active);
    const answers = new Map<string, Record<string, unknown>>();
    if (Array.isArray(input.items)) {
      for (const raw of input.items as Record<string, unknown>[]) answers.set(text(raw.itemId, 64), raw);
    }
    const items: CheckedItem[] = template.map((item) => {
      const given = answers.get(item.id);
      return {
        itemId: item.id, label: item.label, critical: item.critical,
        result: oneOf(given?.result, ['', 'ok', 'fail', 'na'] as const, ''),
        note: text(given?.note, 500),
      };
    });
    const check = createCheck({
      id: newId('chk'), cruiserId: cruiser.id, cruiserUnit: cruiser.unit,
      officerId: user.id, officerName: user.name,
      shift: text(input.shift, 40), odometer: text(input.odometer, 10), items,
      notes: text(input.notes, 2000),
    });
    const blocking = fleetBlocking(checkCheck(check));
    if (blocking.length > 0) {
      return { status: 400, body: { error: `${blocking.length} ${blocking.length === 1 ? 'thing' : 'things'} to fix first.`, problems: checkCheck(check) } };
    }
    const failed = items.filter((i) => i.result === 'fail');
    let numbers = state.maintenance.map((r) => r.number);
    const raised: MaintenanceRequest[] = failed.map((item) => {
      const number = nextRequestNumber(numbers);
      numbers = [...numbers, number];
      return createRequest({
        id: newId('mrq'), number, cruiserId: cruiser.id, cruiserUnit: cruiser.unit,
        reportedBy: user.id, reportedByName: user.name,
        problem: `${item.label}: ${item.note}`,
        urgency: item.critical ? 'unsafe' : 'soon',
        odometer: check.odometer, fromCheckId: check.id,
      });
    });
    check.raisedRequestIds = raised.map((r) => r.id);
    state.cruiserChecks.push(check);
    state.maintenance.push(...raised);
    if (check.odometer) cruiser.odometer = check.odometer;
    const critical = criticalFailures(check);
    if (critical.length > 0 && cruiser.status === 'inService') {
      Object.assign(cruiser, { status: 'outOfService', statusNote: `${critical.map((i) => i.label).join(', ')} — failed on ${user.name}'s check` });
    }
    await audit({ actorId: user.id, actorName: user.name, action: 'fleet.checked', target: cruiser.unit, detail: failed.length > 0 ? `${failed.length} failed` : 'all clear' });
    return ok({ check, requests: raised, offRoad: critical.length > 0 });
  }

  if (parts[1] === 'requests') {
    if (method === 'POST' && !parts[2]) {
      const cruiser = state.cruisers.find((c) => c.id === text(input.cruiserId, 64));
      if (!cruiser) return fail(404, 'No such car.');
      const request = createRequest({
        id: newId('mrq'), number: nextRequestNumber(state.maintenance.map((r) => r.number)),
        cruiserId: cruiser.id, cruiserUnit: cruiser.unit,
        reportedBy: user.id, reportedByName: user.name,
        problem: text(input.problem, 2000).trim(),
        urgency: oneOf(input.urgency, ['routine', 'soon', 'unsafe'] as const, 'routine'),
        odometer: text(input.odometer, 10),
      });
      const blocking = fleetBlocking(checkRequest(request));
      if (blocking.length > 0) return fail(400, blocking[0].message);
      state.maintenance.push(request);
      if (takesOffRoad(request.urgency) && cruiser.status === 'inService') {
        Object.assign(cruiser, { status: 'outOfService', statusNote: `${request.number}: ${request.problem}` });
      }
      await audit({ actorId: user.id, actorName: user.name, action: 'fleet.requested', target: `${cruiser.unit} · ${request.number}`, detail: request.urgency });
      return ok({ request, offRoad: takesOffRoad(request.urgency) });
    }

    if (!can(user, 'reports.approve')) return fail(403, 'A supervisor decides what happens to a maintenance request.');
    const request = state.maintenance.find((r) => r.id === parts[2]);
    if (!request) return fail(404, 'No such request.');
    const status = oneOf(input.status, ['open', 'acknowledged', 'scheduled', 'resolved', 'declined'] as const, request.status);
    const note = text(input.note, 1000).trim();
    if (status === 'declined' && !note) return fail(400, 'Say why it is not being done. The officer who reported it will see this.');
    const now = new Date().toISOString();
    Object.assign(request, {
      status,
      assignedTo: input.assignedTo === undefined ? request.assignedTo : text(input.assignedTo, 200),
      resolvedAt: status === 'resolved' ? now : request.resolvedAt,
      resolution: status === 'resolved' ? note || request.resolution : request.resolution,
    });
    request.history.push({ id: newId('evt'), at: now, actorName: user.name, status, note });

    let backOnRoad = false;
    if (status === 'resolved' || status === 'declined') {
      const stillOpen = state.maintenance.filter(
        (r) => r.cruiserId === request.cruiserId && r.id !== request.id && !['resolved', 'declined'].includes(r.status),
      );
      const cruiser = state.cruisers.find((c) => c.id === request.cruiserId);
      if (stillOpen.length === 0 && cruiser?.status === 'outOfService') {
        Object.assign(cruiser, { status: 'inService', statusNote: '' });
        backOnRoad = true;
      }
    }
    await audit({ actorId: user.id, actorName: user.name, action: 'fleet.requestUpdated', target: `${request.cruiserUnit} · ${request.number}`, detail: status });
    return ok({ request, backOnRoad });
  }

  return fail(404, 'Not found.');
}

/* ------------------------------------------------------------------ */

/**
 * What a court order would touch, in the demo's world.
 *
 * A smaller registry than the server's — this one has no attachments on disk
 * and no DMV returns to sweep — but the shape is the same, and so is the rule
 * that the name index only goes when nothing left points at it.
 */
function manifestFor(order: DisposalOrder): { lines: ManifestLine[]; work: { rows: { id: string; label: string }[]; purge: () => void }[]; auditMatches: number[] } {
  const state = db();
  const byCase = order.scope === 'case';
  const id = order.subjectId;
  const incident = state.incidents.find((i) => i.id === id);
  const person = state.people[id];

  const incidentRows = byCase
    ? state.incidents.filter((i) => i.id === id)
    : state.incidents.filter((i) => i.persons.some((p) => p.masterId === id));
  const incidentIds = new Set(incidentRows.map((i) => i.id));

  const work = [
    { kind: 'Incident reports', rows: incidentRows.map((i) => ({ id: i.id, label: i.caseNumber })), purge: () => remove(state.incidents, incidentIds) },
    { kind: 'Supplements', rows: state.supplements.filter((s) => incidentIds.has(s.caseId)).map((s) => ({ id: s.id, label: `Supplement ${s.number}` })), purge: () => remove(state.supplements, new Set(state.supplements.filter((s) => incidentIds.has(s.caseId)).map((s) => s.id))) },
    { kind: 'Arrest records', rows: state.arrests.filter((a) => (byCase ? a.caseId === id : a.masterId === id)).map((a) => ({ id: a.id, label: a.arrestNumber })), purge: () => remove(state.arrests, new Set(state.arrests.filter((a) => (byCase ? a.caseId === id : a.masterId === id)).map((a) => a.id))) },
    { kind: 'Case to-do items', rows: state.caseTasks.filter((t) => incidentIds.has(t.caseId)).map((t) => ({ id: t.id, label: t.text })), purge: () => remove(state.caseTasks, new Set(state.caseTasks.filter((t) => incidentIds.has(t.caseId)).map((t) => t.id))) },
    { kind: 'Photographs', rows: byCase ? [] : state.photos.filter((p) => p.masterId === id).map((p) => ({ id: p.id, label: `${p.kind || 'photograph'} ${p.takenOn}`.trim() })), purge: () => remove(state.photos, new Set(state.photos.filter((p) => !byCase && p.masterId === id).map((p) => p.id))) },
    {
      kind: 'Master name records',
      rows: !byCase && person && !state.incidents.some((i) => !incidentIds.has(i.id) && i.persons.some((p) => p.masterId === id))
        ? [{ id, label: `${person.lastName}, ${person.firstName}` }]
        : [],
      purge: () => {
        if (!byCase) delete state.people[id];
      },
    },
  ].filter((entry) => entry.rows.length > 0);

  const needles = (byCase ? [incident?.caseNumber ?? ''] : [[person?.lastName, person?.firstName].filter(Boolean).join(', ')])
    .filter((n) => n.length >= 4)
    .map((n) => n.toLowerCase());
  const auditMatches = state.auditLog
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !isRedacted(entry) && needles.some((n) => (entry.target + entry.detail).toLowerCase().includes(n)))
    .map(({ index }) => index);

  return {
    lines: work.map((w) => ({ kind: w.kind, count: w.rows.length, examples: w.rows.slice(0, 4).map((r) => r.label).filter(Boolean) })),
    work,
    auditMatches,
  };
}

function remove<T extends { id: string }>(list: T[], ids: Set<string>): void {
  for (let i = list.length - 1; i >= 0; i -= 1) if (ids.has(list[i].id)) list.splice(i, 1);
}

const GAPS: Record<string, string[]> = {
  case: [
    'Photographs of the people on this case. They belong to the identity, not the case, so an order covering somebody’s photographs has to name the person.',
    'Query returns from DMV and NLETS. Nothing on a return names the case it was run for.',
    'Crash reports naming the same people, unless the order names the crash itself.',
  ],
  person: [
    'Crash reports naming this person. A crash record identifies people by unit and driver, not by the name index.',
    'Notes left on a location, which may name somebody without pointing at their record.',
  ],
};

async function retention(parts: string[], method: string, input: Record<string, unknown>, query: URLSearchParams): Promise<Reply> {
  const state = db();
  const user = currentUser();
  const denied = need('records.seal');
  if (denied) return denied;

  if (!parts[1]) return ok({ orders: state.orders, seals: state.seals });

  if (parts[1] === 'sealed') {
    const subjectId = parts[2];
    if (!state.seals.some((s) => s.subjectId === subjectId)) return fail(404, 'That record is not sealed.');
    const incident = state.incidents.find((i) => i.id === subjectId);
    await audit({
      actorId: user.id, actorName: user.name, action: 'records.sealedViewed',
      target: incident?.caseNumber ?? subjectId, detail: text(query.get('reason'), 300),
    });
    return ok({
      incident: incident ?? null,
      person: state.people[subjectId] ?? null,
      supplements: state.supplements.filter((s) => s.caseId === subjectId),
      arrests: state.arrests.filter((a) => a.caseId === subjectId),
    });
  }

  if (parts[1] === 'orders' && method === 'POST' && !parts[2]) {
    const scope = oneOf(input.scope, ['case', 'person'] as const, 'case');
    const subjectId = text(input.subjectId, 64);
    const incident = state.incidents.find((i) => i.id === subjectId);
    const person = state.people[subjectId];
    if (scope === 'case' ? !incident : !person) return fail(404, `No such ${scope}.`);
    const order = createOrder({
      id: newId('ord'),
      reference: nextOrderReference(state.orders.map((o) => o.reference)),
      kind: oneOf(input.kind, ['seal', 'unseal', 'expunge'] as const, 'seal'),
      court: text(input.court, 200), docket: text(input.docket, 100),
      orderedOn: day(input.orderedOn), instruction: text(input.instruction, 4000),
      scope, subjectId,
      subjectLabel: scope === 'case' ? incident!.caseNumber : [person!.lastName, person!.firstName].filter(Boolean).join(', '),
      createdBy: user.id, createdByName: user.name,
    });
    state.orders.push(order);
    return ok({ order, problems: checkOrder(order) });
  }

  const order = state.orders.find((o) => o.id === parts[2]);
  if (!order) return fail(404, 'No such order.');
  const action = parts[3];

  if (action === 'preview') {
    const manifest = manifestFor(order);
    return ok({ lines: manifest.lines, auditEntries: manifest.auditMatches.length, gaps: GAPS[order.scope] ?? [], problems: checkOrder(order) });
  }

  if (action === 'propose') {
    if (order.status !== 'draft') return fail(409, 'This order has already been proposed.');
    const blocking = orderBlocking(checkOrder(order));
    if (blocking.length > 0) {
      return { status: 400, body: { error: `${blocking.length} ${blocking.length === 1 ? 'thing' : 'things'} to fix first.`, problems: checkOrder(order) } };
    }
    if (order.kind === 'expunge' && !can(user, 'records.expunge')) {
      return fail(403, 'Proposing a destruction order needs the authority to carry one out.');
    }
    Object.assign(order, { status: 'proposed', proposedBy: user.id, proposedByName: user.name, proposedAt: new Date().toISOString() });
    await audit({ actorId: user.id, actorName: user.name, action: 'records.orderProposed', target: order.reference, detail: `${order.kind} · ${order.court} ${order.docket}` });
    return ok({ order });
  }

  if (action === 'withdraw') {
    if (order.status === 'executed') return fail(409, 'This order has already been carried out.');
    const reason = text(input.reason, 500).trim();
    if (!reason) return fail(400, 'Say why it is being withdrawn.');
    Object.assign(order, { status: 'withdrawn', withdrawnReason: reason });
    await audit({ actorId: user.id, actorName: user.name, action: 'records.orderWithdrawn', target: order.reference, detail: reason });
    return ok({ order });
  }

  if (action === 'execute') {
    const needed: Permission = order.kind === 'expunge' ? 'records.expunge' : 'records.seal';
    if (!can(user, needed)) {
      return fail(403, order.kind === 'expunge' ? 'Carrying out a destruction order needs the authority to do it.' : 'You do not have permission to seal records.');
    }
    if (needsTwoPeople(order.kind)) {
      const allowed = canExecute(order, user.id);
      if (!allowed.ok) return fail(403, allowed.reason!);
    } else if (order.status === 'executed') {
      return fail(409, 'This order has already been carried out.');
    }

    const now = new Date().toISOString();
    let certificate = null;
    let redactedCount = 0;

    if (order.kind === 'seal') {
      state.seals = [
        ...state.seals.filter((s) => s.subjectId !== order.subjectId),
        { subjectId: order.subjectId, scope: order.scope, orderRef: order.reference, sealedAt: now, sealedBy: user.name },
      ];
    } else if (order.kind === 'unseal') {
      state.seals = state.seals.filter((s) => s.subjectId !== order.subjectId);
    } else {
      const manifest = manifestFor(order);
      for (const entry of manifest.work) entry.purge();
      for (const index of manifest.auditMatches) {
        state.auditLog[index] = redactEntry(state.auditLog[index], order.reference, now);
      }
      redactedCount = manifest.auditMatches.length;
      state.seals = state.seals.filter((s) => s.subjectId !== order.subjectId);
      certificate = certificateFor({ ...order, executedByName: user.name }, manifest.lines, redactedCount, now);
    }

    const destroyed = order.kind === 'expunge';
    Object.assign(order, {
      status: 'executed', executedBy: user.id, executedByName: user.name, executedAt: now, certificate,
      subjectId: destroyed ? '' : order.subjectId,
      subjectLabel: destroyed ? '' : order.subjectLabel,
    });

    await audit({
      actorId: user.id, actorName: user.name,
      action: destroyed ? 'records.expunged' : 'records.sealed',
      target: order.reference,
      detail: destroyed ? `${certificate?.destroyed ?? 0} records, ${redactedCount} log entries` : `${order.kind} · ${order.court} ${order.docket}`,
    });
    return ok({ order, certificate });
  }

  return fail(404, 'Not found.');
}

/* ------------------------------------------------------------------ */

const CLERK_ONLY: CustodyAction[] = ['moved', 'released', 'destroyed', 'audited', 'corrected'];

async function evidence(parts: string[], method: string, input: Record<string, unknown>): Promise<Reply> {
  const state = db();
  const user = currentUser();

  const summarise = (item: EvidenceItem) => {
    const chain = state.custody[item.id] ?? [];
    return { item, state: custodyState(chain), findings: findingsFor(item, chain, {}) };
  };

  if (!parts[1]) {
    if (method === 'GET') return ok({ evidence: state.evidence.map(summarise) });
    const problems = checkItem(input as never);
    if (problems.length > 0) return fail(400, problems[0].message);
    const item = {
      ...(input as object),
      id: newId('evi'),
      tagNumber: nextTagNumber(state.evidence.map((e) => e.tagNumber)),
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as EvidenceItem;
    const chain = await appendCustody(
      [],
      {
        itemId: item.id, action: 'collected', at: new Date().toISOString(),
        actorId: user.id, actorName: user.name,
        toParty: 'officer', toName: user.name,
        location: text(input.foundAt, 200), reason: 'Seized', witnessId: '', witnessName: '',
      } as never,
      newId('cus'),
    );
    state.evidence.push(item);
    state.custody[item.id] = chain;
    await audit({ actorId: user.id, actorName: user.name, action: 'evidence.booked', target: item.tagNumber, detail: '' });
    return ok({ item, chain, state: custodyState(chain) });
  }

  if (parts[1] === 'meta') {
    return ok({ witnesses: state.users.filter((u) => u.active && u.id !== user.id).map((u) => ({ id: u.id, name: u.name, badge: u.badge })) });
  }

  const item = state.evidence.find((e) => e.id === parts[1]);
  if (!item) return fail(404, 'No such item.');
  const chain = state.custody[item.id] ?? [];

  if (method === 'GET') {
    return ok({ item, chain, state: custodyState(chain), findings: findingsFor(item, chain, {}), verification: await verifyCustody(chain) });
  }
  if (method === 'PATCH') {
    Object.assign(item, input, { id: item.id, updatedAt: new Date().toISOString() });
    return ok({ item });
  }
  if (parts[2] === 'custody') {
    const action = oneOf(input.action, ['collected', 'booked', 'moved', 'checkedOut', 'checkedIn', 'released', 'destroyed', 'audited', 'corrected'] as const, 'moved');
    if (CLERK_ONLY.includes(action) && !can(user, 'evidence.manage')) {
      return fail(403, 'That is a property room action.');
    }
    const witnessId = text(input.witnessId, 64);
    if (witnessId === user.id) return fail(400, 'The witness has to be somebody else.');
    const witness = state.users.find((u) => u.id === witnessId);
    const allowed = canRecord(action, item, chain, Boolean(witness));
    if (!allowed.ok) return fail(409, allowed.reason!);
    const next = await appendCustody(
      chain,
      {
        itemId: item.id, action, at: new Date().toISOString(),
        actorId: user.id, actorName: user.name,
        toParty: oneOf(input.toParty, ['scene', 'storage', 'officer', 'lab', 'court', 'owner', 'agency', 'destruction'] as const, 'storage'),
        toName: text(input.toName, 200), location: text(input.location, 200),
        reason: text(input.reason, 500), witnessId, witnessName: witness?.name ?? '',
      } as never,
      newId('cus'),
    );
    state.custody[item.id] = next;
    return ok({ entry: next[next.length - 1], chain: next, state: custodyState(next) });
  }
  return fail(404, 'Not found.');
}

export { reset };
