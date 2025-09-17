# User ID Standardization Progress

## Problem Description
- Team creation UI was using "나" (Korean) as the user ID
- Most backend logic expects "Me" (English) as the user identifier
- This mismatch prevented agents from making requests/giving feedback to users

## Resolved Issues
1. **Team Creation Page** (`src/app/dashboard/teams/new/page.tsx`)
   - Changed user ID from "나" → "Me"
   - Updated relationship creation logic to use "Me"

2. **Constants File Created** (`src/lib/constants.ts`)
   - Defined USER_ID = "Me" constant
   - Added legacy compatibility functions

3. **Partial Library Updates**
   - `src/lib/memory.ts`: Updated memory system from "나" → "Me"
   - `src/lib/types.ts`: Updated type definition comments

## Files Using "나" (33 files total)

### Core Libraries (High Priority)
- `src/lib/memory.ts` ✅ Updated
- `src/lib/member-utils.ts` - Maintaining legacy compatibility
- `src/lib/relationship-utils.ts` - Maintaining legacy compatibility
- `src/lib/agent-request-handlers.ts` - Needs update
- `src/lib/types.ts` ✅ Comments updated

### Components (UI Display Related)
- `src/components/FeedbackTabContent.tsx` - User message identification
- `src/components/FeedbackSessionModal.tsx` - Feedback session UI
- `src/components/ViewFeedbackSessionModal.tsx` - Feedback viewing UI
- `src/components/IdeaDetailModal.tsx` - Idea detail screen
- `src/components/RelationshipGraph.tsx` - Relationship graph

### API & Actions
- `src/actions/ideation.actions.ts` - Idea evaluation
- `src/app/api/teams/[teamId]/feedback-sessions/` - Feedback APIs
- `src/app/ideation/[teamId]/components/` - Ideation UI components

## Processing Strategy
1. **New Data Creation**: Use "Me" (✅ Completed)
2. **Existing Data**: Maintain compatibility for both "나" and "Me" through legacy mapping in relationship-utils.ts
3. **UI Components**: Gradual migration to "Me" (Future work)

## Immediate Impact
- Newly created teams will have agents (Diana, Kitty, etc.) properly recognize the user
- Request/feedback functionality should work correctly

## Future Work (Optional)
- Sequential migration of "나" → "Me" in component files
- Migration of existing "나" data to "Me" in database
- Central management using constants.ts

## Technical Details

### Key Changes Made
```typescript
// Before: Team creation with Korean user ID
id: "나",
isUser: true,

// After: Team creation with English user ID
id: "Me",
isUser: true,
```

### Legacy Compatibility
```typescript
// relationship-utils.ts maintains compatibility
const legacyNormalizedFromId = (normalizedFromId === "Me" || normalizedFromId === "나")
  ? ["Me", "나"] : [normalizedFromId];
```

### Constants for Central Management
```typescript
// src/lib/constants.ts
export const USER_ID = "Me";
export const LEGACY_USER_ID = "나";

export function isUserIdVariant(id: string): boolean {
  return id === USER_ID || id === LEGACY_USER_ID;
}
```

## Expected Outcome
Agents with Request and Feedback roles should now be able to properly identify and interact with users in newly created teams, resolving the "no target found" error messages.