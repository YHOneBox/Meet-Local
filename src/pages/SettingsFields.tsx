import type { Prefs } from '../prefs'

export function SettingsFields({ prefs, onChange }: { prefs: Prefs; onChange: (next: Prefs) => void }) {
  function set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    onChange({ ...prefs, [key]: value })
  }

  return (
    <div className="settings-fields" data-testid="settings-fields">
      <label className="field">
        <span>Font size</span>
        <select data-testid="settings-font" value={prefs.fontSize} onChange={(event) => set('fontSize', event.target.value as Prefs['fontSize'])}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
      <label className="field">
        <span>Meeting style</span>
        <select data-testid="settings-style" value={prefs.style} onChange={(event) => set('style', event.target.value as Prefs['style'])}>
          <option value="night">Night</option>
          <option value="paper">Paper</option>
          <option value="contrast">High contrast</option>
        </select>
      </label>
      <label className="field">
        <span>Default view</span>
        <select data-testid="settings-layout" value={prefs.layout} onChange={(event) => set('layout', event.target.value as Prefs['layout'])}>
          <option value="gallery">Gallery</option>
          <option value="speaker">Speaker</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.micOn} data-testid="settings-mic-default" onChange={(event) => set('micOn', event.target.checked)} />
        Microphone on when I join
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.camOn} data-testid="settings-cam-default" onChange={(event) => set('camOn', event.target.checked)} />
        Camera on when I join
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.mirror} onChange={(event) => set('mirror', event.target.checked)} />
        Mirror my camera
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.processing} onChange={(event) => set('processing', event.target.checked)} />
        Echo cancellation, noise suppression, and auto gain
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.saveData} data-testid="settings-save-data" onChange={(event) => set('saveData', event.target.checked)} />
        Lower video quality to save bandwidth
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.waitingRoom} data-testid="settings-waiting-default" onChange={(event) => set('waitingRoom', event.target.checked)} />
        Ask to admit people by default
      </label>
    </div>
  )
}
