/*
 * The settings shell: the section strip, the profile form (birthday, personal
 * channel, photo upload, log out) and whichever panel owns the open section.
 *
 * Ported from svelte/src/lib/components/Settings.svelte. The `$effect` that loads
 * a section's data the first time it is opened is a `useSignalEffect`, because it
 * reads the `section` signal and signal reads are what that hook tracks. The
 * `{#if}`/`{:else if}` chain that picked the open section's body is resolved into
 * one `body` value before the single return, as in `AppearanceSettings.tsx`.
 *
 * The stylesheet still carries a `.toggle` rule the Svelte markup never used; it
 * is copied verbatim with the rest of the sheet.
 */
import {useRef} from 'preact/hooks';
import {useSignal, useSignalEffect} from '@preact/signals';

import {AppearanceSettings} from './AppearanceSettings';
import {Avatar} from './Avatar';
import {BusinessSettings} from './BusinessSettings';
import {DataSettings} from './DataSettings';
import {ImageCropper} from './ImageCropper';
import {NotificationSettings} from './NotificationSettings';
import {PremiumPanel} from './PremiumPanel';
import {PrivacySettings} from './PrivacySettings';
import {StarsPanel} from './StarsPanel';
import {
  loadAttachBots,
  loadBirthdayPrivacy,
  loadPersonalChannels,
  loadProfile,
  removeProfilePhoto,
  saveBirthday,
  saveBirthdayPrivacy,
  savePersonalChannel,
  saveProfile,
  saveUsername,
  uploadProfilePhoto,
  type AttachBot,
  type BirthdayPrivacy,
  type PersonalChannelOption,
  type ProfileInfo
} from '$lib/telegram/settings';
import {invalidateAvatarUrl} from '$lib/telegram/chats';
import {logOutCurrentAccount} from '$lib/telegram/accounts';

import './Settings.css';

interface Props {
  onclose: () => void;
  onminiapp: (botId: number) => void;
}

type Section =
  | 'profile'
  | 'appearance'
  | 'notifications'
  | 'privacy'
  | 'security'
  | 'data'
  | 'premium'
  | 'stars'
  | 'business'
  | 'bots';

// The literal list the markup iterated over inline. It is typed here so `key` is
// already a `Section` and the `as Section` cast the original carried at each
// `onclick` drops away — the values are already the right union.
const SECTIONS: [Section, string][] = [
  ['profile', 'Profile'],
  ['appearance', 'Appearance'],
  ['notifications', 'Notifications'],
  ['privacy', 'Privacy'],
  ['security', 'Security'],
  ['data', 'Data'],
  ['premium', 'Premium'],
  ['stars', 'Stars'],
  ['business', 'Business'],
  ['bots', 'Bots']
];

export function Settings({onclose, onminiapp}: Props) {
  const section = useSignal<Section>('profile');

  const profile = useSignal<ProfileInfo | null>(null);
  const firstName = useSignal('');
  const lastName = useSignal('');
  const bio = useSignal('');
  const username = useSignal('');
  const saving = useSignal(false);
  const status = useSignal('');
  const error = useSignal('');

  const bots = useSignal<AttachBot[]>([]);

  // Profile extras: birthday, personal channel, avatar.
  const birthdayDate = useSignal('');
  const birthdayPrivacy = useSignal<BirthdayPrivacy>('nobody');
  const channels = useSignal<PersonalChannelOption[]>([]);
  const personalChannelId = useSignal(0);
  // Kept in a plain ref, not a signal — the File goes to the cropper and its
  // Blob to the worker, and a value wrapped in a proxy there would fail to
  // clone.
  const pendingPhoto = useRef<File | null>(null);
  const cropping = useSignal(false);
  const photoBusy = useSignal('');
  const avatarVersion = useSignal(0);
  const photoInput = useRef<HTMLInputElement>(null);

  useSignalEffect(() => {
    const current = section.value;
    error.value = '';

    (async() => {
      try {
        // The Stars panel needs our own id to list the gifts on this profile.
        if((current === 'profile' || current === 'stars') && !profile.value) {
          profile.value = await loadProfile();
          firstName.value = profile.value.firstName;
          lastName.value = profile.value.lastName;
          bio.value = profile.value.bio;
          username.value = profile.value.username;
          personalChannelId.value = profile.value.personalChannelId;
          birthdayDate.value = profile.value.birthday ?
            `${String(profile.value.birthday.year ?? 1900).padStart(4, '0')}-${String(profile.value.birthday.month).padStart(2, '0')}-${String(profile.value.birthday.day).padStart(2, '0')}` :
            '';

          // Both are extras — a failure here must not blank the profile form.
          loadBirthdayPrivacy().then((value) => (birthdayPrivacy.value = value)).catch(() => {});
          loadPersonalChannels().then((value) => (channels.value = value)).catch(() => {});
        } else if(current === 'bots' && !bots.value.length) {
          bots.value = await loadAttachBots();
        }
      } catch(err: any) {
        error.value = err?.type || err?.message || 'Failed to load';
      }
    })();
  });

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
  }

  async function submitProfile() {
    saving.value = true;
    error.value = '';
    try {
      await saveProfile(firstName.value.trim(), lastName.value.trim(), bio.value.trim());
      if(profile.value && username.value.trim() !== profile.value.username) {
        await saveUsername(username.value.trim());
      }
      profile.value = await loadProfile();
      flash('Saved');
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to save';
    } finally {
      saving.value = false;
    }
  }

  /** `<input type="date">` gives `YYYY-MM-DD`; a blank value clears the birthday. */
  async function submitBirthday() {
    saving.value = true;
    error.value = '';
    try {
      if(!birthdayDate.value) {
        await saveBirthday(null);
      } else {
        const [year, month, day] = birthdayDate.value.split('-').map(Number);
        if(!day || !month) throw new Error('That date is not valid');
        // Telegram treats the year as optional; 1900 is our "not given" marker.
        await saveBirthday({day, month, year: year && year > 1900 ? year : null});
      }

      profile.value = await loadProfile();
      flash('Birthday saved');
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to save birthday';
    } finally {
      saving.value = false;
    }
  }

  async function changeBirthdayPrivacy(value: BirthdayPrivacy) {
    const previous = birthdayPrivacy.value;
    birthdayPrivacy.value = value;
    try {
      await saveBirthdayPrivacy(value);
    } catch(err: any) {
      birthdayPrivacy.value = previous;
      error.value = err?.type || err?.message || 'Failed to update birthday privacy';
    }
  }

  async function changePersonalChannel(peerId: number) {
    const previous = personalChannelId.value;
    personalChannelId.value = peerId;
    try {
      await savePersonalChannel(peerId);
      flash(peerId ? 'Personal channel set' : 'Personal channel removed');
    } catch(err: any) {
      personalChannelId.value = previous;
      error.value = err?.type || err?.message || 'Failed to set the personal channel';
    }
  }

  function pickPhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if(!file) return;

    pendingPhoto.current = file;
    cropping.value = true;
  }

  async function commitPhoto(blob: Blob) {
    cropping.value = false;
    pendingPhoto.current = null;
    photoBusy.value = 'upload';
    error.value = '';

    try {
      await uploadProfilePhoto(blob);
      if(profile.value) invalidateAvatarUrl(profile.value.userId);
      profile.value = await loadProfile();
      // Bumping the key remounts <Avatar/>, which re-reads the freshly
      // invalidated URL rather than showing the old cached one.
      avatarVersion.value++;
      flash('Profile photo updated');
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to upload the photo';
    } finally {
      photoBusy.value = '';
    }
  }

  async function dropPhoto() {
    if(!profile.value?.photoId || !confirm('Remove your profile photo?')) return;

    photoBusy.value = 'remove';
    error.value = '';
    try {
      await removeProfilePhoto(profile.value.photoId);
      invalidateAvatarUrl(profile.value.userId);
      profile.value = await loadProfile();
      avatarVersion.value++;
      flash('Profile photo removed');
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to remove the photo';
    } finally {
      photoBusy.value = '';
    }
  }

  const confirmingLogOut = useSignal(false);
  const loggingOut = useSignal(false);

  async function doLogOut() {
    if(loggingOut.value) return;
    loggingOut.value = true;
    try {
      // Clean removal: this clears the account's storages, shifts the remaining
      // accounts down a slot, and lets apiManagerProxy navigate to whichever
      // account is active afterwards. Reloading here would race that redirect.
      await logOutCurrentAccount();
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Logout failed';
      loggingOut.value = false;
      confirmingLogOut.value = false;
    }
  }

  // The `{#if} {:else if} … {:else}` chain that picked the open section's body,
  // resolved before the single return.
  let body: preact.JSX.Element;

  if(section.value === 'profile') {
    body = !profile.value ?
      <p class="muted">Loading…</p> :
      (
        <>
          <div class="head">
            <Avatar key={avatarVersion.value} peerId={profile.value.userId} title={firstName.value || 'Me'} size={84} />
            <p class="phone">{profile.value.phone}{profile.value.isPremium ? ' · Premium' : ''}</p>
            <div class="photo-actions">
              <button class="small-btn" onClick={() => photoInput.current?.click()} disabled={!!photoBusy.value}>
                {photoBusy.value === 'upload' ? 'Uploading…' : profile.value.photoId ? 'Change photo' : 'Set photo'}
              </button>
              {profile.value.photoId && (
                <button class="danger small-btn" onClick={dropPhoto} disabled={!!photoBusy.value}>
                  {photoBusy.value === 'remove' ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
            <input
              class="file-input"
              type="file"
              accept="image/*"
              ref={photoInput}
              onChange={pickPhoto}
            />
          </div>
          <label class="field"><span>First name</span><input value={firstName.value} onInput={(e) => (firstName.value = (e.target as HTMLInputElement).value)} /></label>
          <label class="field"><span>Last name</span><input value={lastName.value} onInput={(e) => (lastName.value = (e.target as HTMLInputElement).value)} /></label>
          <label class="field"><span>Bio</span><input value={bio.value} maxlength={70} onInput={(e) => (bio.value = (e.target as HTMLInputElement).value)} /></label>
          <label class="field"><span>Username</span><input value={username.value} onInput={(e) => (username.value = (e.target as HTMLInputElement).value)} /></label>
          <button class="primary" onClick={submitProfile} disabled={saving.value}>
            {saving.value ? 'Saving…' : 'Save'}
          </button>

          <p class="label">Birthday</p>
          <label class="field">
            <span>Date</span>
            <input type="date" value={birthdayDate.value} onInput={(e) => (birthdayDate.value = (e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span>Who can see it</span>
            <select
              value={birthdayPrivacy.value}
              onChange={(e) => changeBirthdayPrivacy(e.currentTarget.value as BirthdayPrivacy)}
            >
              <option value="everybody">Everybody</option>
              <option value="contacts">My contacts</option>
              <option value="nobody">Nobody</option>
            </select>
          </label>
          <p class="muted small">
            Setting a birthday does not reveal it on its own — the privacy above
            decides who sees it, and contacts who share theirs with you see yours.
          </p>
          <button class="small-btn" onClick={submitBirthday} disabled={saving.value}>
            {birthdayDate.value ? 'Save birthday' : 'Clear birthday'}
          </button>

          <p class="label">Personal channel</p>
          {!channels.value.length ?
            <p class="muted small">
              You do not administer any channel that can be shown on your profile.
            </p> :
            <label class="field">
              <span>Shown on your profile</span>
              <select
                value={personalChannelId.value}
                onChange={(e) => changePersonalChannel(Number(e.currentTarget.value))}
              >
                <option value={0}>None</option>
                {channels.value.map((channel) => (
                  <option key={channel.peerId} value={channel.peerId}>{channel.title}</option>
                ))}
              </select>
            </label>}

          {confirmingLogOut.value ?
            <>
              <p class="label">Log out of this account? Your other accounts stay signed in.</p>
              <div class="confirm-row">
                <button onClick={() => (confirmingLogOut.value = false)} disabled={loggingOut.value}>Cancel</button>
                <button class="danger" onClick={doLogOut} disabled={loggingOut.value}>
                  {loggingOut.value ? 'Logging out…' : 'Log out'}
                </button>
              </div>
            </> :
            <button class="danger" onClick={() => (confirmingLogOut.value = true)}>Log out</button>}
        </>
      );
  } else if(section.value === 'appearance') {
    body = <AppearanceSettings />;
  } else if(section.value === 'notifications') {
    body = <NotificationSettings />;
  } else if(section.value === 'privacy' || section.value === 'security') {
    body = <PrivacySettings view={section.value} />;
  } else if(section.value === 'data') {
    body = <DataSettings onerror={(message) => (error.value = message)} />;
  } else if(section.value === 'premium') {
    body = <PremiumPanel />;
  } else if(section.value === 'stars') {
    body = profile.value ?
      <StarsPanel selfId={profile.value.userId} /> :
      <p class="muted">Loading…</p>;
  } else if(section.value === 'business') {
    body = <BusinessSettings onerror={(message) => (error.value = message)} />;
  } else {
    body = (
      <>
        {!bots.value.length ?
          <p class="muted">No mini apps installed.</p> :
          bots.value.map((bot) => (
            <button key={bot.botId} class="bot" onClick={() => onminiapp(bot.botId)}>
              <Avatar peerId={bot.botId} title={bot.name || 'Bot'} size={36} />
              <span>{bot.name || 'Mini app'}</span>
            </button>
          ))}
        <p class="muted small">
          Inline bots also work from the composer — type @botname followed by a query.
        </p>
      </>
    );
  }

  return (
    <>
      <aside class="settings">
        <header>
          <span>Settings</span>
          <button class="close" onClick={onclose} aria-label="Close">✕</button>
        </header>

        <nav>
          {SECTIONS.map(([key, label], i) => (
            <button key={i} class={section.value === key ? 'active' : ''} onClick={() => (section.value = key)}>{label}</button>
          ))}
        </nav>

        <div class="body">
          {error.value && <p class="error">{error.value}</p>}
          {status.value && <p class="ok">{status.value}</p>}

          {body}
        </div>
      </aside>

      {cropping.value && pendingPhoto.current && (
        <ImageCropper
          file={pendingPhoto.current}
          title="Crop your profile photo"
          onconfirm={commitPhoto}
          oncancel={() => {
            cropping.value = false;
            pendingPhoto.current = null;
          }}
        />
      )}
    </>
  );
}
