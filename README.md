# Range Finder Codebase Guide

Range Finder is a static, browser-based location mission game. Players enter a mission code, the app loads a mission JSON file, and the player advances through GPS, compass, prompt, search, timed, and ending stages.

This guide explains how the code is organized, how runtime state flows through the app, how mission/stage files are authored, and where to modify the code when adding new behavior.

## Feature Overview

Range Finder currently supports:

- Mission-code loading from `missions/manifest.json`.
- Resumable mission progress through `localStorage`.
- GPS distance scans to objectives or complication safe zones.
- Compass-based signal scans that point players toward targets.
- Location checks for arrive, evacuate, timed, and search objectives.
- Prompt stages with branching, hints, mission switching, and time modifiers.
- Search stages where players claim a configurable number of points.
- Timed stages with success/failure transitions.
- Recurring complications that check whether players are inside safe zones.
- Ending stages that stop active timers and show final mission time.

This README focuses on the game engine, project structure, and stage mechanics. It intentionally does not document or rewrite mission story text, clue wording, or narrative content.

## Cleanup Priorities

Before expanding the project much further, the main cleanup opportunities are:

- Continue splitting the large `app.js` controller into smaller modules for state, mission loading, rendering, search, prompts, and actions.
- Add mission JSON validation so malformed stages fail early with useful errors.
- Add a clear schema reference or TypeScript-style typedefs for mission, step, target, response, search point, and complication objects.
- Move inline button labels/status strings into constants so UI copy is easier to audit.
- Add automated tests for pure functions in `js/objective.js`, `js/common.js`, and transition helpers.
- Add a small development server script or documented standard command so contributors run the app consistently.
- Preserve mission text separately from engine cleanup unless intentionally editing mission content.

## Project Layout

```text
.
|-- index.html                  # App shell and HUD markup
|-- style.css                   # Terminal-style visual design
|-- app.js                      # Main controller, state, UI, mission flow
|-- js/
|   |-- common.js               # GPS sampling, averaging, distance math
|   |-- distance.js             # Distance scan helper
|   |-- signal.js               # Compass/bearing/signal scan helper
|   `-- objective.js            # Objective and prompt evaluation helpers
`-- missions/
    |-- manifest.json           # Mission-code registry
    `-- mission-demo.json       # Example mission definition
```

The app has no build step. It is loaded as native browser ES modules and fetches mission JSON at runtime, so it should be served from a local or hosted web server rather than opened directly from disk.

## Runtime Requirements

- A modern browser with ES module support.
- Geolocation permission for GPS-based scans and location checks.
- Device orientation/compass support for signal scans.
- HTTPS in production. Browsers generally require a secure context for geolocation and device orientation APIs, although `localhost` is normally treated as secure for development.

For quick local testing, serve the folder with any static server:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## High-Level Flow

1. `index.html` creates two main screens:
   - `#accessScreen` for mission-code entry.
   - `#gameScreen` for mission text, HUD scans, prompts, and location checks.
2. `app.js` binds DOM elements, event listeners, and global mission state.
3. On load, `DOMContentLoaded` checks `localStorage` for a saved mission and shows the resume button if one exists.
4. When the user enters a mission code, `handleLoadMission()` calls `loadMissionByCode()`.
5. `loadMissionByCode()` loads `missions/manifest.json`, matches the entered code, fetches the referenced mission JSON, and normalizes every step.
6. `bootMission()` initializes runtime state, search state, complication state, HUD values, timers, persistence, and renders the first step.
7. Player actions call `scanDistance()`, `scanSignal()`, `checkLocation()`, or `submitPrompt()`.
8. Successful objectives advance with `jumpMission()` or `advanceStep()`.
9. Mission progress is persisted after meaningful state changes so the mission can be resumed.

## Main Controller: `app.js`

`app.js` is the orchestration layer. It owns DOM references, current mission state, UI rendering, persistence, timers, and all button handlers.

### Important State Variables

```js
let activeMission = null;
let activeStepIndex = 0;
let activeStepStartedAt = 0;
let activeMissionStartedAt = 0;
let activeMissionEndedAt = 0;
let activeTimeModifierMs = 0;
let activeSearchState = {};
```

- `activeMission`: the loaded mission JSON after normalization.
- `activeStepIndex`: index of the current step in `activeMission.steps`.
- `activeStepStartedAt`: timestamp used for timed objectives.
- `activeMissionStartedAt`: timestamp used for final mission time.
- `activeMissionEndedAt`: timestamp captured when an ending step is reached.
- `activeTimeModifierMs`: accumulated time penalties or bonuses.
- `activeSearchState`: per-search-step claimed point IDs.

Complication timer/check state is owned by `js/complications.js`. There are also boolean in-progress flags for scans, location checks, and prompt submission. Those flags prevent duplicate async work and drive button disabled states.

### Rendering and UI State

Key rendering helpers:

- `setStatus(message, type, target)`: updates access or game status text.
- `renderMission()`: writes mission title, current step text, search progress, ending time summary, HUD controls, and primary action visibility.
- `refreshHudButtons()`: enables/disables scan, signal, location, and prompt controls based on the current step.
- `refreshPrimaryAction()`: switches between location-check UI and prompt UI.
- `refreshScanTargetOptions()`: shows the safe-zone scan target only when the mission has complication safe zones.
- `refreshSearchPointOptions()`: populates the search-point selector for search objectives.

`renderMission()` is the safest place to start when changing what the player sees after a step transition.

### Mission Loading

Mission codes are resolved through `missions/manifest.json`.

```json
{
  "missions": [
    {
      "code": "DEMO",
      "title": "Range Finder Demo Mission",
      "location": "Test Area",
      "file": "mission-demo.json"
    }
  ]
}
```

`loadMissionByCode(code)` normalizes user input by trimming, uppercasing, and removing whitespace. It also supports hashed mission codes: the entered code is SHA-256 hashed, and the manifest entry matches if `m.code` equals either the plain normalized code or the hash.

After loading, `normalizeMission(mission)` ensures every step has a `step_id`. If a step does not define one, it receives `step_1`, `step_2`, etc.

### Step Transitions

All movement between steps should go through:

- `jumpMission(target, reason)`: jumps to a step by `step_id`, integer index, or numeric string.
- `advanceStep()`: moves to the next step.

`jumpMission()` resets HUD readings, clears prompt input, renders the new step, and calls `activateCurrentStep()` so timers and persistence stay correct.

Use `transitions.success` and `transitions.fail` in mission JSON whenever a stage should branch:

```json
"transitions": {
  "success": "next_step_id",
  "fail": "failure_step_id"
}
```

Timed objectives can also use `rules.onFailGoTo`.

### Persistence

Progress is stored under:

```js
const STORAGE_KEY = "signalcore_active_mission";
```

`saveActiveMissionState()` writes the whole active mission plus current step, timestamps, time modifiers, complication state, and search state to `localStorage`.

`resumeMission()` restores that data. If the saved step has a `stepId`, the app prefers it over the saved numeric index so mission authors can insert steps without always invalidating saved progress.

### Timing

There are two timing systems:

- Step timers for timed objectives.
- Complication timers for recurring mission events.

Timed objectives:

- `isTimedStep(step)` checks whether the objective ends in `_timed`.
- `getStepTimeLimitMs(step)` reads `step.rules.timeMs` or `step.timeMs`.
- `startActiveStepTimer()` schedules a timeout from `activeStepStartedAt`.
- `handleTimedObjectiveExpired()` jumps to failure if a failure target exists, otherwise it leaves the player on the step with a failure status.

Mission time:

- `getMissionElapsedMs()` measures total mission duration.
- `activeTimeModifierMs` stores penalties/bonuses.
- Ending steps show elapsed time, adjustment, and final time.

### Complications

Complications are recurring checks that run while the mission is active and not on an ending step. They are configured on the mission, not individual steps.

Each complication has two separate names:

- `complication`: reusable behavior key used by the engine.
- `complicationName`: player-facing or story-facing name for this mission.

The currently supported behavior key is `safe_zone_penalty`.

```json
"complications": [
  {
    "complication": "safe_zone_penalty",
    "complicationName": "Arcana Storm",
    "intervalMs": 6000,
    "safeZones": [
      {
        "lat": 1.4409950891778704,
        "lng": 103.78318866758065,
        "radiusMeters": 50
      }
    ],
    "onSuccess": {
      "message": "Safe zone confirmed."
    },
    "onFail": {
      "message": "Signal surge caught you in the open. Time penalty applied.",
      "timeModifierMs": 300000
    }
  }
]
```

Flow:

1. `createComplicationController()` owns complication state, HUD rendering, and the recurring timer.
2. `complications.initialize()` creates one state object per complication.
3. `complications.start()` starts a 1-second interval.
4. The controller updates warning bars and resolves any complication that is due.
5. Resolving a complication gets the player's averaged GPS position.
6. If the player is inside a safe zone, `onSuccess.message` is shown.
7. Otherwise `onFail.message` is shown and `onFail.timeModifierMs` is applied.
8. The next complication fire time is scheduled and persisted.

Safe-zone scans in the HUD are derived from all complication safe zones. They let the player scan toward the nearest safe zone instead of the current objective.

## GPS and Signal Modules

### `js/common.js`

This file contains shared location and distance utilities.

- `calculateDistanceMeters(lat1, lng1, lat2, lng2)`: haversine distance rounded to meters.
- `getCurrentPosition(timeoutMs)`: one high-accuracy geolocation read.
- `getAveragedPosition(durationMs, intervalMs, options)`: collects several GPS samples, prefers accurate clustered samples, and returns a weighted average.

The averaging logic is intentionally defensive because mobile GPS readings can jump. It tries `watchPosition()` first, falls back to polling `getCurrentPosition()`, clusters around the best accuracy sample, then weights samples by inverse accuracy squared.

### `js/distance.js`

`scanDistance(step)` expects `step.target` and returns:

```js
{
  meters,
  current
}
```

`current` is the averaged player position. `meters` is the distance from the player to the target.

### `js/signal.js`

`scanSignal(step)` expects `step.target` and returns:

```js
{
  bearing,
  heading,
  signal
}
```

It averages the player's GPS position and device heading, computes the bearing to the target, compares bearing to heading, and formats a 10-character signal bar display.

Notes for maintenance:

- iOS-style browsers may require an explicit `DeviceOrientationEvent.requestPermission()` call.
- The code listens to both `deviceorientation` and `deviceorientationabsolute`.
- Circular heading averages are used so readings around 359/0 degrees average correctly.

## Objective Module: `js/objective.js`

This module holds objective and prompt evaluation rules independent of the DOM.

### `evaluateObjective(step, context)`

Supported objective values:

- `arrive`: succeeds when distance to target is less than or equal to radius.
- `arrive_timed`: same as `arrive`, but fails once the time limit is reached.
- `evacuate`: succeeds when distance to target is greater than or equal to radius.
- `evacuate_timed`: same as `evacuate`, but fails once the time limit is reached.
- `ending`: returns an ending status.

Radius is read from `step.target.radiusMeters`, defaulting to `20`.

Timed objectives read the limit from:

```js
step.rules.timeMs ?? step.timeMs
```

### `resolvePrompt(step, rawInput)`

Prompt matching is exact after normalization:

- Trim surrounding whitespace.
- Uppercase text.
- Collapse internal whitespace to one space.

Responses can define the matched text as `input`, `text`, or `match`.

## Mission JSON Format

Top-level mission shape:

```json
{
  "code": "DEMO",
  "title": "Range Finder Demo Mission",
  "location": "Test Area",
  "complications": [
    {
      "complication": "safe_zone_penalty",
      "complicationName": "Arcana Storm",
      "intervalMs": 60000,
      "safeZones": [],
      "onFail": {
        "timeModifierMs": 300000
      }
    }
  ],
  "steps": []
}
```

### Common Step Fields

```json
{
  "step_id": "unique_step_id",
  "objective": "arrive",
  "title": "Step Title",
  "text": "Player-facing instructions.",
  "target": {
    "lat": 1.4409950891778704,
    "lng": 103.78318866758065,
    "radiusMeters": 50
  },
  "transitions": {
    "success": "next_step_id",
    "fail": "failure_step_id"
  },
  "distanceEnabled": true,
  "signalEnabled": true,
  "locationEnabled": true
}
```

Field notes:

- `step_id`: stable ID used for branching and save restoration. Treat it as an API; avoid renaming it after a mission is live.
- `objective`: determines how the stage behaves.
- `title`: displayed above the step text.
- `text` or `instruction`: displayed to the player.
- `target`: required by GPS objectives and scans toward the objective.
- `radiusMeters`: accepted radius for location checks.
- `transitions.success`: optional destination when objective succeeds.
- `transitions.fail`: optional destination when objective fails.
- `distanceEnabled`, `signalEnabled`, `locationEnabled`: optional UI controls. They default to `true`, except where app logic disables them for endings, prompt steps, or safe-zone search mode.

## Existing Stage Types

### Arrive

Use when the player must get within a radius of a target.

```json
{
  "step_id": "arrive_1",
  "objective": "arrive",
  "title": "Investigate Signal Source",
  "text": "Move to the reported signal source.",
  "target": {
    "lat": 1.4409950891778704,
    "lng": 103.78318866758065,
    "radiusMeters": 50
  },
  "transitions": {
    "success": "read_sign"
  }
}
```

### Evacuate

Use when the player must move away from a target. It succeeds when distance is greater than or equal to `radiusMeters`.

```json
{
  "step_id": "leave_area",
  "objective": "evacuate",
  "title": "Clear the Area",
  "text": "Move outside the unstable signal field.",
  "target": {
    "lat": 1.4409950891778704,
    "lng": 103.78318866758065,
    "radiusMeters": 80
  },
  "transitions": {
    "success": "next_step"
  }
}
```

### Timed Arrive or Evacuate

Append `_timed` and provide `timeMs` or `rules.timeMs`.

```json
{
  "step_id": "reach_fast",
  "objective": "arrive_timed",
  "title": "Beat the Surge",
  "text": "Reach the target before the signal window closes.",
  "target": {
    "lat": 1.4409950891778704,
    "lng": 103.78318866758065,
    "radiusMeters": 50
  },
  "rules": {
    "timeMs": 120000,
    "onFailGoTo": "slow_failure"
  },
  "transitions": {
    "success": "next_step",
    "fail": "slow_failure"
  }
}
```

If the timer expires, `handleTimedObjectiveExpired()` prefers `rules.onFailGoTo`, then `transitions.fail`.

### Prompt

Use when the player must type a response. Prompt steps hide the location-check button and show the response input.

```json
{
  "step_id": "read_sign",
  "objective": "prompt",
  "title": "Read the Trail Sign",
  "text": "Type the words written on the signboard.",
  "responses": [
    {
      "input": "HINDHEDE TRAIL",
      "goto": "route_hindhede"
    },
    {
      "input": "H1",
      "hint": "Look for the smallest sign near the path entrance."
    }
  ],
  "locationEnabled": false
}
```

Supported response action fields:

- `hint` or `message`: show status text without necessarily advancing.
- `goto`, `stepId`, `stepIndex`, or `next`: jump to another step.
- `mission` or `missionCode`: load a different mission by code.
- `timeModifierMs`: apply a time penalty or bonus.

You can also nest these inside `action`:

```json
{
  "input": "RED",
  "action": {
    "goto": "red_route",
    "timeModifierMs": 30000
  }
}
```

Prompt steps can also collect multiple valid answers over time with `multiAnswer`.
Use this when players need any number of long recovered quotes or riddle answers,
and you want the app to confirm each correct submission separately.

```json
{
  "step_id": "quote_check",
  "objective": "prompt",
  "title": "Quote Verification",
  "text": "Type READY to submit recovered quotes.\nType BACK to return and investigate more.\n\nVerify any two quotes.",
  "multiAnswer": {
    "required": 2,
    "back": "route_hub",
    "completeGoto": "final_riddle",
    "answers": [
      {
        "id": "quote_a",
        "input": "THE FIRST RECOVERED SENTENCE",
        "message": "Quote A verified."
      },
      {
        "id": "quote_b",
        "input": "THE SECOND RECOVERED SENTENCE",
        "message": "Quote B verified."
      },
      {
        "id": "quote_c",
        "inputs": [
          "THE THIRD RECOVERED SENTENCE",
          "AN ACCEPTED ALTERNATE VERSION"
        ],
        "message": "Quote C verified."
      }
    ]
  },
  "locationEnabled": false
}
```

Multi-answer prompt notes:

- `READY` starts answer verification. Set `requireReady` to `false` to allow answers immediately.
- `BACK` jumps to `back`, `backGoto`, or `cancelGoto` if configured.
- `required` or `requiredMatches` controls how many answers are needed.
- `completeGoto`, `goto`, `next`, `stepId`, or `transitions.success` controls where completion goes.
- Answers accept `input`, `text`, `match`, `inputs`, or `matches`.
- Matched answer IDs are saved by `step_id`, so progress survives reloads.

### Search

Use when the player can claim multiple possible target points. The player scans or checks the selected search point until enough points are claimed.

```json
{
  "step_id": "treasure_hunt",
  "objective": "search",
  "title": "Recover Signal Fragments",
  "text": "Claim any two signal fragments.",
  "requiredClaims": 2,
  "searchPoints": [
    {
      "id": "A",
      "label": "POINT A",
      "lat": 1.4409950891778704,
      "lng": 103.78318866758065,
      "radiusMeters": 50
    },
    {
      "id": "B",
      "label": "POINT B",
      "lat": 1.4411,
      "lng": 103.7833,
      "radiusMeters": 50
    }
  ],
  "transitions": {
    "success": "goodending"
  }
}
```

Rules:

- `requiredClaims` defaults to all search points.
- `required` is accepted as an alias.
- Claimed point IDs are saved by `step_id`.
- Search steps use the selected unclaimed point as the objective scan target.
- Once enough points are claimed, the app follows `transitions.success` or advances to the next step.

### Ending

Use for terminal story states. Ending steps disable scans, stop timers, stop complications, save the mission end time, and display the final time summary.

```json
{
  "step_id": "goodending",
  "objective": "ending",
  "title": "Mission Complete",
  "text": "You followed the clue and reached the correct route.",
  "distanceEnabled": false,
  "signalEnabled": false,
  "locationEnabled": false
}
```

## Adding a New Stage to a Mission

To add a stage using existing mechanics:

1. Open the target file under `missions/`.
2. Add a new object to `steps`.
3. Give it a stable, unique `step_id`.
4. Choose an existing `objective`.
5. Add any required fields:
   - `target` for arrive/evacuate/timed objectives.
   - `responses` for prompt objectives.
   - `searchPoints` for search objectives.
6. Connect it with `transitions.success`, `transitions.fail`, prompt `goto`, or the previous step's transition.
7. Add or adjust endings if the new path should terminate differently.
8. Reload the app through a web server and test the full route.

Example inserting a simple arrive stage between `read_sign` and `treasure_hunt`:

```json
{
  "step_id": "checkpoint_bridge",
  "objective": "arrive",
  "title": "Cross the Bridge",
  "text": "Reach the bridge checkpoint before continuing.",
  "target": {
    "lat": 1.4412,
    "lng": 103.7834,
    "radiusMeters": 40
  },
  "transitions": {
    "success": "treasure_hunt"
  },
  "distanceEnabled": true,
  "signalEnabled": true,
  "locationEnabled": true
}
```

Then update the earlier step to point to `checkpoint_bridge`.

## Adding a New Mission

1. Create `missions/mission-your-name.json`.
2. Follow the top-level mission shape shown above.
3. Register it in `missions/manifest.json`.

```json
{
  "code": "YOURCODE",
  "title": "Your Mission Title",
  "location": "Mission Area",
  "file": "mission-your-name.json"
}
```

Mission codes are normalized by removing whitespace and uppercasing. If you want a code with spaces for readability, the user can type it with or without spaces.

## Adding a New Objective Type

Adding a new objective requires code changes in more than one place because the controller needs to know how to render, enable controls, evaluate completion, and transition.

Recommended checklist:

1. Define objective evaluation in `js/objective.js`.
   - Add a `case` in `evaluateObjective()`.
   - Return one of the existing statuses where possible: `succeed`, `failed`, `not_met`, or `ending`.
   - Keep the function DOM-free.
2. Add helper detection in `app.js` if the type needs custom UI.
   - Current examples are `isPromptStep(step)` and `isSearchStep(step)`.
3. Update `refreshHudButtons()` if control availability differs from normal GPS objectives.
4. Update `refreshPrimaryAction()` if the objective needs a different primary action area.
5. Update `renderMission()` if it needs extra progress text.
6. Update `checkLocation()` or add a specialized handler if normal distance evaluation is not enough.
7. Update scan targeting if scans should point somewhere other than `step.target`.
   - Current custom logic lives in `getObjectiveScanTarget(step)`.
8. Add mission JSON examples and test with at least one success and one failure path.

Keep objective logic split this way:

- Pure evaluation belongs in `js/objective.js`.
- Browser/device APIs belong in `js/common.js`, `js/distance.js`, or `js/signal.js`.
- DOM, persistence, timers, and transitions belong in `app.js`.

## Common Modification Recipes

### Change GPS Accuracy Behavior

Edit `js/common.js`.

Useful knobs:

- `getAveragedPosition(durationMs, intervalMs, options)`
- `collectWatchedPositions()`
- `desiredAccuracyMeters`
- `maxUsableAccuracyMeters`
- `minSamples`
- `minDurationMs`

Increasing duration and sample counts improves stability but makes scans feel slower.

### Change Accepted Radius for a Stage

Edit the mission JSON:

```json
"target": {
  "lat": 1.4409950891778704,
  "lng": 103.78318866758065,
  "radiusMeters": 75
}
```

For search points, each point has its own `radiusMeters`.

### Add a Time Penalty

Use either a complication failure:

```json
"onFail": {
  "message": "Penalty applied.",
  "timeModifierMs": 300000
}
```

Or a prompt response:

```json
{
  "input": "WRONG DOOR",
  "hint": "That route costs time.",
  "timeModifierMs": 60000
}
```

Positive values add time. Negative values reduce final time.

### Branch Based on Typed Input

Use a prompt stage with multiple responses:

```json
"responses": [
  {
    "input": "NORTH",
    "goto": "north_route"
  },
  {
    "input": "SOUTH",
    "goto": "south_route"
  }
]
```

### Make a Stage Lore-Only

Use a prompt with a simple expected input, or add an `ending` if it should stop. There is currently no dedicated "continue" button stage type. If adding one, implement it as a new objective type so the controller can render a proper primary action.

## Testing Checklist

Because this app depends on physical-device APIs, test both code paths and real device behavior.

Code checks:

```powershell
node --check .\app.js
node --check .\js\common.js
node --check .\js\distance.js
node --check .\js\signal.js
node --check .\js\objective.js
```

Browser checks:

- Mission code loads from the manifest.
- Resume button appears after progress is saved.
- Distance scan asks for location and updates the HUD.
- Signal scan asks for compass permission where required.
- Location check advances, fails, or stays put as expected.
- Prompt matching handles casing and extra spaces.
- Multi-answer prompts persist verified answers and advance at the required count.
- Search stages persist claimed points after reload.
- Timed stages transition on timeout.
- Complications trigger, apply time modifiers, and stop on endings.
- Ending steps show the final time summary.

## Maintenance Notes and Pitfalls

- Stable `step_id` values matter. Saved missions use them to recover the current step after resume.
- Async handlers capture the current `step_id` and ignore stale results if the player transitions before a scan finishes. Preserve this pattern in new async handlers.
- `localStorage` stores the whole mission object. If you change a mission file while a saved mission exists, the player may resume the old stored copy until the saved mission is cleared.
- `fetch()` and ES modules usually fail when opened as `file://`; use a server.
- GPS and compass APIs can fail for permissions, insecure origins, unsupported devices, or poor signal. Handlers already catch and display errors.
- Search-state keys are based on `step_id`. Renaming a search step loses saved claims for that step.
- Complication state keys are derived from `complication`, `complicationName`, and the complication's array position. Avoid reordering active mission complications once players are using a mission.
- UI controls default to enabled for normal steps. Explicitly set `distanceEnabled`, `signalEnabled`, or `locationEnabled` to `false` when a stage should hide a mechanic from the player.

## Design Boundaries

Keep the separation of concerns intact:

- Mission authors should usually only edit files under `missions/`.
- Engine behavior should live in `js/`.
- UI orchestration and persistence belong in `app.js`.
- Visual changes belong in `style.css`.

When adding new capabilities, prefer extending the mission schema in a backward compatible way. Existing mission files should continue to load without edits.
