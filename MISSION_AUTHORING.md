# Mission Authoring Guide

This guide explains how to add missions to Range Finder without changing the app code.
Mission authors usually only edit files in `missions/`.

Use this when you want to:

- Add a new mission code.
- Create a new `mission.json` file.
- Choose which objective type a stage should use.
- Build branching, timed, text-only, search, or GPS-based missions.

## Quick Start

1. Create a new mission file in `missions/`, for example `missions/mission-night-run.json`.
2. Add top-level mission details: `code`, `title`, `location`, `intro`, and `steps`.
3. Add one or more step objects inside `steps`.
4. Give every step a stable `step_id`.
5. Choose an `objective` for every step.
6. Connect steps with `transitions.success`, `transitions.fail`, or prompt response `goto`.
7. Register the mission in `missions/manifest.json`.
8. Run the app from a local web server and test the mission code.

Example manifest entry:

```json
{
  "code": "NIGHTRUN",
  "title": "Night Run Training",
  "location": "Training Area",
  "file": "mission-night-run.json"
}
```

Mission codes are normalized when typed by the player. Spaces are removed and letters are uppercased, so `night run`, `NIGHTRUN`, and `Night Run` all resolve to the same code if the manifest code is `NIGHTRUN`.

## Mission File Shape

A mission file is a JSON object with mission metadata and a `steps` array.

```json
{
  "code": "NIGHTRUN",
  "title": "Night Run Training",
  "location": "Training Area",
  "intro": "Move through the route and report each checkpoint.",
  "complications": [],
  "steps": [
    {
      "step_id": "start",
      "objective": "prompt",
      "title": "Ready Check",
      "text": "Type READY to begin.",
      "responses": [
        {
          "input": "READY",
          "goto": "checkpoint_1"
        }
      ],
      "distanceEnabled": false,
      "signalEnabled": false,
      "locationEnabled": false
    }
  ]
}
```

Top-level fields:

- `code`: mission code. Usually matches the manifest entry.
- `title`: mission title shown in the mission feed.
- `location`: short location label shown above the step text.
- `intro`: fallback intro text.
- `complications`: optional recurring mission-wide events.
- `steps`: ordered list of mission stages.

The app requires `steps` to be an array. If a step does not have `step_id`, the app will generate one like `step_1`, but mission authors should write explicit IDs so branching and saved progress stay stable.

## Common Step Fields

Most steps use this shape:

```json
{
  "step_id": "checkpoint_1",
  "objective": "arrive",
  "title": "Reach Checkpoint 1",
  "text": "Move to the first checkpoint and confirm your location.",
  "target": {
    "lat": 1.3380666180001501,
    "lng": 103.70767263084102,
    "radiusMeters": 60
  },
  "transitions": {
    "success": "checkpoint_2",
    "fail": "bad_ending"
  },
  "distanceEnabled": true,
  "signalEnabled": true,
  "locationEnabled": true
}
```

Common fields:

- `step_id`: stable unique ID for this step. Use lowercase words with underscores, such as `base_camp_checkin`.
- `objective`: stage behavior. See objective types below.
- `title`: step heading shown in the mission feed.
- `text`: player-facing instructions. `instruction` is also accepted as a fallback.
- `target`: GPS target used by distance scans, signal scans, and location checks.
- `transitions.success`: step to jump to when the objective succeeds.
- `transitions.fail`: step to jump to when the objective fails.
- `distanceEnabled`: show or hide the distance scan button.
- `signalEnabled`: show or hide the bearings/signal scan button.
- `locationEnabled`: show or hide the location check button.

The UI flags default to `true` on normal steps. Set them to `false` when a mechanic should not be available.

## Objective Types

The current mission JSON supports these objective values:

- `arrive`
- `evacuate`
- `arrive_timed`
- `evacuate_timed`
- `prompt`
- `search`
- `ending`

### `arrive`

Use `arrive` when the player must get within a target radius.

The objective succeeds when the player's distance to `target` is less than or equal to `target.radiusMeters`.

```json
{
  "step_id": "reach_marker",
  "objective": "arrive",
  "title": "Reach the Marker",
  "text": "Move to the marked point and confirm your position.",
  "target": {
    "lat": 1.3380666180001501,
    "lng": 103.70767263084102,
    "radiusMeters": 60
  },
  "transitions": {
    "success": "read_marker"
  },
  "distanceEnabled": true,
  "signalEnabled": true,
  "locationEnabled": true
}
```

Player controls usually available:

- `SCAN`: shows distance to the target.
- `SCAN SIGNAL`: points toward the target using bearings.
- `CHECK LOCATION`: checks whether the player is inside the accepted radius.

### `evacuate`

Use `evacuate` when the player must move away from a target.

The objective succeeds when the player's distance from `target` is greater than or equal to `target.radiusMeters`.

```json
{
  "step_id": "clear_area",
  "objective": "evacuate",
  "title": "Clear the Area",
  "text": "Move at least 300 meters away from the contact point.",
  "target": {
    "lat": 1.3386171005968814,
    "lng": 103.70724816507742,
    "radiusMeters": 300
  },
  "transitions": {
    "success": "good_ending"
  },
  "distanceEnabled": true,
  "signalEnabled": false,
  "locationEnabled": true
}
```

This is useful for escape, extraction, danger-zone, or "create distance" stages.

### `arrive_timed`

Use `arrive_timed` when the player must reach a target before time runs out.

```json
{
  "step_id": "reach_fast",
  "objective": "arrive_timed",
  "title": "Beat the Window",
  "text": "Reach the target within 5 minutes.",
  "target": {
    "lat": 1.339718473626013,
    "lng": 103.70917063149574,
    "radiusMeters": 60
  },
  "rules": {
    "timeMs": 300000,
    "onFailGoTo": "bad_ending"
  },
  "transitions": {
    "success": "good_ending",
    "fail": "bad_ending"
  },
  "distanceEnabled": true,
  "signalEnabled": true,
  "locationEnabled": true
}
```

Timing fields:

- `rules.timeMs`: time limit in milliseconds.
- `timeMs`: also accepted directly on the step.
- `rules.onFailGoTo`: preferred timeout destination.
- `transitions.fail`: fallback timeout or failure destination.

If time runs out, the app jumps to `rules.onFailGoTo` first. If that is missing, it uses `transitions.fail`.

### `evacuate_timed`

Use `evacuate_timed` when the player must get away before time runs out.

```json
{
  "step_id": "evacuate_area",
  "objective": "evacuate_timed",
  "title": "Evacuate the Area",
  "text": "Move at least 300 meters away within 5 minutes.",
  "target": {
    "lat": 1.3386171005968814,
    "lng": 103.70724816507742,
    "radiusMeters": 300
  },
  "rules": {
    "timeMs": 300000,
    "onFailGoTo": "bad_ending"
  },
  "transitions": {
    "success": "good_ending",
    "fail": "bad_ending"
  },
  "distanceEnabled": true,
  "signalEnabled": false,
  "locationEnabled": true
}
```

This combines the `evacuate` distance rule with a countdown.

### `prompt`

Use `prompt` when the player must type a response instead of checking GPS.

```json
{
  "step_id": "decision",
  "objective": "prompt",
  "title": "Decision Drill",
  "text": "Type 1 to evacuate.\nType 2 to confront head on.",
  "responses": [
    {
      "input": "1",
      "goto": "evacuate_area"
    },
    {
      "input": "2",
      "goto": "confront_head_on"
    },
    {
      "input": "HINT",
      "hint": "Choose the route that best fits your current position."
    }
  ],
  "distanceEnabled": false,
  "signalEnabled": false,
  "locationEnabled": false
}
```

Prompt matching:

- Player input is trimmed.
- Input is uppercased.
- Multiple spaces are collapsed into one space.
- A response matches only when the normalized text is exact.

Response match fields:

- `input`
- `text`
- `match`

Response action fields:

- `hint` or `message`: show status text.
- `goto`: jump to a step by `step_id`.
- `stepId`: same idea as `goto`.
- `stepIndex`: jump to a numeric step index.
- `next`: another alias for a step jump.
- `mission` or `missionCode`: load a different mission by code.
- `timeModifierMs`: add a time penalty or bonus.

Actions can be written directly:

```json
{
  "input": "HINT",
  "hint": "Look near the entrance sign."
}
```

Or nested inside `action`:

```json
{
  "input": "RED",
  "action": {
    "goto": "red_route",
    "timeModifierMs": 30000
  }
}
```

Positive `timeModifierMs` adds time. Negative `timeModifierMs` subtracts time.

### `prompt` with `multiAnswer`

Use `multiAnswer` when a prompt step should accept several possible answers and require only some of them.

Example: require any two quotes out of three.

```json
{
  "step_id": "quote_gate",
  "objective": "prompt",
  "title": "Quote Verification",
  "text": "Type READY to begin.\nType BACK to return.\n\nVerify any two recovered quotes.",
  "multiAnswer": {
    "required": 2,
    "back": "branch_choice",
    "readyMessage": "Quote verification is ready. Submit one quote at a time.",
    "notReadyMessage": "Type READY before submitting quotes.",
    "duplicateMessage": "That quote was already verified.",
    "noMatchMessage": "No quote matched. Check spelling and try again, or type BACK.",
    "completeMessage": "Enough quotes verified. Advancing.",
    "completeGoto": "final_confirmation",
    "answers": [
      {
        "id": "quote_a",
        "input": "THE FIRST SIGNAL IS GREEN",
        "message": "Quote A verified."
      },
      {
        "id": "quote_b",
        "input": "THE SECOND MARKER IS SILENT",
        "message": "Quote B verified."
      },
      {
        "id": "quote_c",
        "inputs": [
          "THE THIRD DOOR OPENS NORTH",
          "THE THIRD DOOR OPENS TO THE NORTH"
        ],
        "message": "Quote C verified."
      }
    ]
  },
  "distanceEnabled": false,
  "signalEnabled": false,
  "locationEnabled": false
}
```

`multiAnswer` fields:

- `answers`: list of accepted answers.
- `required`: number of answers needed to complete the step.
- `requiredMatches`: alias for `required`.
- `completeGoto`: step to jump to after enough answers are verified.
- `goto`, `next`, or `stepId`: also accepted as completion targets.
- `back`, `backGoto`, or `cancelGoto`: target for the back command.
- `readyInput`: custom ready word. Defaults to `READY`.
- `backInput`: custom back word. Defaults to `BACK`.
- `requireReady`: set to `false` if answers should work immediately.

Answer fields:

- `id`: stable answer ID used for saved progress.
- `label`: accepted as an ID fallback.
- `input`, `text`, or `match`: one accepted answer string.
- `inputs` or `matches`: multiple accepted answer strings.
- `message`: status text after this answer is verified.
- `duplicateMessage`: optional status text if this answer is submitted again.

The mission feed shows `VERIFIED: current / required` for multi-answer prompts.

### `search`

Use `search` when the player can claim several possible GPS points.

```json
{
  "step_id": "marker_hunt",
  "objective": "search",
  "title": "Recover Range Markers",
  "text": "Claim any three of the four markers.",
  "requiredClaims": 3,
  "searchPoints": [
    {
      "id": "M1",
      "label": "MARKER 1",
      "lat": 1.3385897780261784,
      "lng": 103.7072046065405,
      "radiusMeters": 60
    },
    {
      "id": "M2",
      "label": "MARKER 2",
      "lat": 1.339445980922502,
      "lng": 103.70837398104847,
      "radiusMeters": 60
    }
  ],
  "transitions": {
    "success": "next_step"
  },
  "distanceEnabled": true,
  "signalEnabled": true,
  "locationEnabled": true
}
```

Search fields:

- `searchPoints`: list of claimable GPS points.
- `requiredClaims`: number of points needed.
- `required`: alias for `requiredClaims`.
- `transitions.success`: where to go after enough points are claimed.

Search point fields:

- `id`: stable point ID used for saved progress.
- `label`: player-facing label in the search point selector.
- `lat`: latitude.
- `lng`: longitude.
- `radiusMeters`: accepted claim radius.

The player chooses an unclaimed search point from the selector. Distance and signal scans point to the selected point. `CHECK LOCATION` changes to `CLAIM LOCATION`.

The mission feed shows `CLAIMED: current / required` for search steps.

### `ending`

Use `ending` for a terminal success, failure, or story ending.

```json
{
  "step_id": "good_ending",
  "objective": "ending",
  "title": "Mission Complete",
  "text": "Exercise complete. Your team passed.",
  "distanceEnabled": false,
  "signalEnabled": false,
  "locationEnabled": false
}
```

When an ending is reached, the app:

- Stops active step timers.
- Stops complications.
- Saves the mission end time.
- Shows the final time summary.
- Disables location, distance, and signal controls.

## Mission Patterns

These are common mission shapes you can build from the objective types.

### Text-Only Mission

Use only `prompt` and `ending` steps.

Good for:

- Testing branch logic.
- Puzzle/riddle missions.
- Missions that do not need GPS.

Pattern:

```text
prompt start -> prompt choice -> prompt final -> ending
```

Reference example: `missions/mission-test.json`.

### Linear GPS Route

Use a sequence of `arrive` steps and finish with an `ending`.

Good for:

- Walking routes.
- Checkpoint games.
- Simple field exercises.

Pattern:

```text
arrive checkpoint_1 -> arrive checkpoint_2 -> arrive checkpoint_3 -> ending
```

### Branching Mission

Use a `prompt` step to choose different routes.

Good for:

- Decision drills.
- Story branches.
- Difficulty choices.

Pattern:

```text
arrive setup -> prompt choice -> route A or route B -> ending
```

### Timed Challenge

Use `arrive_timed` or `evacuate_timed`.

Good for:

- Reach a place before a window closes.
- Escape an area before time expires.
- Score-style missions where penalties matter.

Pattern:

```text
prompt ready -> arrive_timed objective -> success ending
                                    -> timeout failure ending
```

### Search / Collection Mission

Use `search` when there are many possible points and the player only needs some of them.

Good for:

- Collect any 3 of 5 markers.
- Find hidden stations.
- Recover scattered clues.

Pattern:

```text
arrive staging_area -> search marker_hunt -> prompt final_code -> ending
```

### Mission With Complications

Add `complications` at the top level when something should recur throughout the mission.

Currently supported complication:

- `safe_zone_penalty`

Example:

```json
{
  "complication": "safe_zone_penalty",
  "complicationName": "Spot Check",
  "intervalMs": 600000,
  "safeZones": [
    {
      "lat": 1.3380666180001501,
      "lng": 103.70767263084102,
      "radiusMeters": 60
    }
  ],
  "onCheck": {
    "message": "Spot Check in progress."
  },
  "onSuccess": {
    "message": "Spot Check clear."
  },
  "onFail": {
    "message": "Spot Check failed. Fifteen minute penalty applied.",
    "timeModifierMs": 900000
  }
}
```

Complication fields:

- `complication`: behavior key. Currently only `safe_zone_penalty`.
- `complicationName`: player-facing name.
- `intervalMs`: how often the check runs.
- `safeZones`: list of safe GPS zones.
- `onCheck.message`: status text when the check starts.
- `onSuccess.message`: status text if the player is inside a safe zone.
- `onFail.message`: status text if the player is outside safe zones.
- `onFail.timeModifierMs`: time penalty or bonus.

When a mission has safe zones, the HUD can scan toward the nearest safe zone as well as the current objective.

## Transitions and Branching

Use `step_id` values for transitions whenever possible.

For GPS objectives:

```json
"transitions": {
  "success": "next_step",
  "fail": "bad_ending"
}
```

For prompt responses:

```json
{
  "input": "A",
  "goto": "route_a"
}
```

For timed failures:

```json
"rules": {
  "timeMs": 300000,
  "onFailGoTo": "bad_ending"
}
```

If a successful step has no `transitions.success`, the app usually advances to the next step in the `steps` array.

## Targets and Coordinates

GPS targets use decimal latitude and longitude.

```json
{
  "lat": 1.3380666180001501,
  "lng": 103.70767263084102,
  "radiusMeters": 60
}
```

Use a larger `radiusMeters` when:

- GPS drift is expected.
- The player is in an area with buildings or trees.
- The real-world target is physically large.
- You want easier testing.

Use a smaller `radiusMeters` when:

- The target must be precise.
- The location has reliable GPS.
- You want a harder challenge.

## Testing Checklist

Before sharing a mission:

1. Confirm the mission file is valid JSON.
2. Confirm the mission is listed in `missions/manifest.json`.
3. Enter the mission code from the app's access screen.
4. Test every prompt response, including wrong answers and hints.
5. Test every branch route.
6. Test every GPS target with distance scan and location check.
7. Test timed success and timeout failure paths.
8. Test search claiming until completion.
9. Test every ending.
10. Clear saved mission state or use a fresh browser session after editing mission JSON.

Saved missions store a copy of the mission in `localStorage`. If you edit a mission file while an old save exists, the app may resume the old stored copy until the saved mission is cleared.

## Authoring Rules of Thumb

- Keep `step_id` values stable after a mission is live.
- Prefer `step_id` transitions over numeric `stepIndex` jumps.
- Set all GPS steps with a clear `target`.
- Set prompt steps with `distanceEnabled`, `signalEnabled`, and `locationEnabled` as `false` unless you intentionally want scan controls visible.
- Put success and failure endings at the end of the mission file.
- Use `mission-test.json` to test text mechanics before adding complicated GPS routes.
- Use `mission-jcp.json` as a reference for GPS, search, timed, branching, and complication behavior.
