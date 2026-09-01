import { useState } from 'react';
import { KeyRound, Plus, ShieldCheck, UserMinus, UserPlus, UserRound } from 'lucide-react';
import { useStore } from '@/state/store';
import {
  assignableRoles,
  canDeactivate,
  canManageUser,
  grantablePermissions,
  isDesignated,
  PERMISSION_LABEL,
  ROLE_LABEL,
  type Permission,
  type Role,
  type User,
} from '@/domain/auth';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Account provisioning.
 *
 * Two tiers. An agency administrator sets up their own officers; the vendor
 * sets up the administrator when a new agency comes on. Nobody can hand out
 * more authority than they hold themselves — the options below are filtered to
 * the actor, and the store re-checks on every write, because a hidden option is
 * not a guard.
 */
export function UserAdmin() {
  const { users, currentUser, createAccount, deactivateUser, reactivateUser } = useStore();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);

  const active = users.filter((u) => u.active);
  const inactive = users.filter((u) => !u.active);

  return (
    <Panel
      title="Accounts"
      description={`Signed in as ${currentUser.name} — ${ROLE_LABEL[currentUser.role]}. You can create accounts up to your own level of authority.`}
      aside={
        <Button size="sm" variant="primary" onClick={() => setAdding((a) => !a)}>
          <Plus size={13} aria-hidden />
          New account
        </Button>
      }
    >
      {adding && (
        <NewAccountForm
          onCancel={() => setAdding(false)}
          onCreate={async (input) => {
            const result = await createAccount(input);
            if (result.ok) {
              setAdding(false);
              setError(null);
              setIssued({
                name: input.name?.trim() ?? 'the new account',
                password: result.temporaryPassword ?? '',
              });
            } else {
              setError(result.reason ?? 'Could not create the account.');
            }
          }}
        />
      )}

      {error && (
        <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>
      )}

      {issued && (
        <div className="mb-4 rounded-xl border border-ok/35 bg-ok-soft p-4">
          <p className="text-[13px] font-medium text-ink">
            Account created for {issued.name}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            Give them this temporary password. It is shown once and never stored in readable form,
            and they must change it the first time they sign in.
          </p>
          <p className="mt-2 rounded-lg bg-surface px-3 py-2 font-mono text-[15px] tracking-wide text-ink">
            {issued.password}
          </p>
          <Button size="sm" className="mt-3" onClick={() => setIssued(null)}>
            I have passed it on
          </Button>
        </div>
      )}

      <ul className="divide-y divide-line">
        {active.map((user) => (
          <li key={user.id}>
            <AccountRow
              user={user}
              onDeactivate={() => {
                const result = deactivateUser(user.id);
                setError(result.ok ? null : (result.reason ?? null));
              }}
            />
          </li>
        ))}
      </ul>

      {inactive.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-faint">
            Deactivated
          </p>
          <ul className="divide-y divide-line">
            {inactive.map((user) => (
              <li key={user.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-muted">{user.name}</span>
                  <span className="block text-[11.5px] text-faint">
                    {ROLE_LABEL[user.role]} · deactivated {relativeTime(user.deactivatedAt)}
                  </span>
                </span>
                {canManageUser(currentUser, user) && (
                  <Button size="sm" onClick={() => reactivateUser(user.id)}>
                    Reactivate
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
            Accounts are deactivated rather than deleted. An officer who has left still authored
            reports and notes, and those have to keep resolving to a person.
          </p>
        </div>
      )}
    </Panel>
  );
}

function AccountRow({ user, onDeactivate }: { user: User; onDeactivate: () => void }) {
  const { users, currentUser } = useStore();
  const designations = (Object.keys(PERMISSION_LABEL) as Permission[]).filter((p) =>
    isDesignated(user, p),
  );
  const guard = canDeactivate(currentUser, user, users);
  const isSelf = user.id === currentUser.id;

  return (
    <div className="flex items-start gap-3 py-3">
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
          user.role === 'vendor' || user.role === 'admin'
            ? 'bg-accent-soft text-accent'
            : 'bg-raised text-muted',
        )}
      >
        {user.role === 'vendor' || user.role === 'admin' ? (
          <ShieldCheck size={15} aria-hidden />
        ) : (
          <UserRound size={15} aria-hidden />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-ink">{user.name}</span>
          {user.badge && user.badge !== '—' && (
            <span className="text-[12px] text-faint">#{user.badge}</span>
          )}
          <Badge tone={user.role === 'vendor' ? 'accent' : 'neutral'}>{ROLE_LABEL[user.role]}</Badge>
          {isSelf && <Badge tone="ok">You</Badge>}
        </div>

        <p className="mt-0.5 text-[12px] text-muted">
          {user.username && <span className="font-mono">{user.username}</span>}
          {user.createdBy && ` · set up by ${user.createdBy}`}
        </p>

        {designations.length > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <KeyRound size={11} className="text-accent" aria-hidden />
            {designations.map((p) => (
              <span
                key={p}
                className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent"
              >
                {PERMISSION_LABEL[p]}
              </span>
            ))}
          </p>
        )}
      </div>

      {canManageUser(currentUser, user) && (
        <Button
          size="sm"
          variant="danger"
          disabled={!guard.ok}
          title={guard.reason}
          onClick={onDeactivate}
        >
          <UserMinus size={13} aria-hidden />
          Deactivate
        </Button>
      )}
    </div>
  );
}

function NewAccountForm({
  onCreate,
  onCancel,
}: {
  onCreate: (input: Partial<User>) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { currentUser } = useStore();
  const roles = assignableRoles(currentUser);
  const grantable = grantablePermissions(currentUser);

  const [draft, setDraft] = useState<{
    name: string;
    badge: string;
    username: string;
    role: Role;
    grants: Permission[];
  }>({ name: '', badge: '', username: '', role: roles[0] ?? 'officer', grants: [] });

  const control =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-faint';

  const toggleGrant = (permission: Permission) =>
    setDraft((d) => ({
      ...d,
      grants: d.grants.includes(permission)
        ? d.grants.filter((p) => p !== permission)
        : [...d.grants, permission],
    }));

  return (
    <div className="mb-4 rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <UserPlus size={14} className="text-accent" aria-hidden />
        New account
      </p>

      <div className="mt-3 grid grid-cols-4 gap-3">
        <label className="col-span-2">
          <span className="mb-1.5 block text-[12.5px] text-muted">Name</span>
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="J. Alvarez"
            className={control}
          />
        </label>
        <label>
          <span className="mb-1.5 block text-[12.5px] text-muted">Badge</span>
          <input
            value={draft.badge}
            onChange={(e) => setDraft({ ...draft, badge: e.target.value })}
            className={control}
          />
        </label>
        <label>
          <span className="mb-1.5 block text-[12.5px] text-muted">Username</span>
          <input
            value={draft.username}
            onChange={(e) => setDraft({ ...draft, username: e.target.value.toLowerCase() })}
            placeholder="jalvarez"
            className={cn(control, 'font-mono')}
          />
        </label>
      </div>

      <div className="mt-3 max-w-xs">
        <label>
          <span className="mb-1.5 block text-[12.5px] text-muted">Role</span>
          <select
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}
            className={control}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {grantable.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[12.5px] text-muted">
            Also designate for — permissions beyond the role. You can only pass on what you hold.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {grantable.map((permission) => {
              const on = draft.grants.includes(permission);
              return (
                <button
                  key={permission}
                  type="button"
                  onClick={() => toggleGrant(permission)}
                  aria-pressed={on}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-[12.5px] transition',
                    on
                      ? 'border-accent/50 bg-surface font-medium text-ink'
                      : 'border-line text-muted hover:bg-surface/60',
                  )}
                >
                  {PERMISSION_LABEL[permission]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!draft.name.trim() || !draft.username.trim()}
          onClick={() => void onCreate(draft)}
        >
          Create account
        </Button>
      </div>
    </div>
  );
}
