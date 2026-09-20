# Milestone 1: Collaborative trip planning and ranked flight suggestions

Status: Living design document; implementation has not started as part of this design work.

Last updated: 2026-09-19.

This document records the agreed product behavior, the proposed planning architecture, and unresolved questions. Confirmed decisions are requirements. Recommendations and open questions are explicitly labeled and should not be treated as settled behavior.

## 1. Goal and scope

Build a social travel-planning website where users iteratively define a trip, collaborate with other travelers, express requirements and preferences, and ask a scheduling system to produce ranked flight suggestions using Ignav fare data.

Milestone 1 supports one destination per plan and round-trip flights. It ends at ranked suggestions. Multi-stop routing, partial-trip travel parties, booking, and planning transport to a shared departure point are outside this milestone.

### Users and trips

- Maintain a persistent database of users. Collect each user's home city during signup as the default starting point for planning.
- Start with sign-in through Google and personal Microsoft accounts.
- Sign in with Apple is outside this milestone and may be reconsidered later.
- Users can create, read, update, and delete their trips. A newly created trip needs only a name; destinations and constraints are added iteratively.
- A trip owner can invite other users and manage trip membership and membership in travel parties.
- Constraints are defined per user, per trip. Party membership and shared party preferences supplement those individual constraints.
- A trip needs at least one destination and a date constraint to begin planning. Running a fare search additionally requires bounded departure and return date ranges and a resolved origin.

### Initial sign-in provider setup

Production sign-in is handled by Azure App Service Authentication at the API application. Local sign-in is handled by server-side provider middleware in the API container. Neither flow is implemented in the React client. Provider client secrets must remain server-side in Azure Key Vault and must never be committed, added to the browser application, or pasted into this document.

Before configuring either provider, deploy or identify the API App Service hostname, represented below as `<api-app>.azurewebsites.net`.

#### Google

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and complete the Google Auth Platform branding and audience setup. Use an external audience for a consumer application. During testing, add the intended test accounts.
2. Create an OAuth 2.0 client ID with application type **Web application**.
3. Add `https://<api-app>.azurewebsites.net` as an authorized JavaScript origin. Add both `https://<api-app>.azurewebsites.net/.auth/login/google/callback` and `http://localhost:5173/.auth/callback/google` as authorized redirect URIs on this same Web client.
4. Record the generated client ID and client secret. The secret is only displayed at creation time; download or copy it immediately to the approved secret store.

Google requires the redirect URI to match exactly. Only basic `openid`, `profile`, and `email` scopes are needed for initial sign-in. See [Google's OAuth web-server guidance](https://developers.google.com/identity/protocols/oauth2/web-server) and [Azure App Service's Google provider guidance](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-google).

#### Personal Microsoft accounts

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/), select **App registrations**, and create a **New registration**.
2. Select **Personal Microsoft accounts only** as the supported account type.
3. Under **Authentication**, add both Web platform redirect URIs: `https://<api-app>.azurewebsites.net/.auth/login/aad/callback` and `http://localhost:5173/.auth/callback/microsoft`.
4. On the Overview page, record the **Application (client) ID**.
5. Under **Certificates & secrets**, create a client secret. Copy its **Value** immediately; the portal will not show it again. Use a short expiration and plan rotation before it expires.

Use the personal-Microsoft-account issuer `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0` when configuring App Service Authentication. This consumer tenant only accepts personal Microsoft accounts. See [Microsoft's App Service provider guidance](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-aad) and [Microsoft account-type guidance](https://learn.microsoft.com/en-us/security/zero-trust/develop/identity-supported-account-types).

#### Project integration

Store these four values in Azure Key Vault under names recognized by the project scripts:

| Provider | Client ID secret name | Client secret name |
| --- | --- | --- |
| Google | `google-client-id` | `google-client-secret` |
| Microsoft | `microsoft-client-id` | `microsoft-client-secret` |

Run `scripts/secrets set-auth` to store all four values, `scripts/secrets status` to verify their presence without displaying them, and `scripts/release` to apply the Google and Microsoft App Service Authentication configuration.

#### Localhost development

Production uses Azure App Service Authentication. Local development uses equivalent server-side provider handlers in the API container, with Vite proxying the authentication routes so the browser stays on `http://localhost:5173`.

Each provider registration therefore needs two Web callback URLs:

| Provider | Production callback owner and URI | Local callback owner and URI |
| --- | --- | --- |
| Google | Azure Easy Auth: `https://<api-app>.azurewebsites.net/.auth/login/google/callback` | ASP.NET Google handler: `http://localhost:5173/.auth/callback/google` |
| Microsoft Entra | Azure Easy Auth: `https://<api-app>.azurewebsites.net/.auth/login/aad/callback` | ASP.NET OpenID Connect handler: `http://localhost:5173/.auth/callback/microsoft` |

Azure Easy Auth defines the production `/.auth/login/<provider>/callback` paths. The local callback paths are application-defined in `Program.cs`; Vite exposes and proxies them on port 5173. The browser initiates either flow at `/.auth/login/google` or `/.auth/login/aad`. These sign-in entry points are separate from the callback URLs registered with Google and Entra. The `aad` provider identifier remains part of Azure App Service's route even though the product is now named Microsoft Entra.

Run `scripts/server` to retrieve the four authentication values from Azure Key Vault and start Docker Compose. The values are passed through the script process only to the API container; they are not written to an `.env` file or exposed through Vite. Running `docker compose up` directly leaves local authentication disabled.

The local API issues an HTTP-only development cookie after provider sign-in. App Service continues to own the production session and inject the authenticated principal header there.

### Travel parties and authority

- For this milestone, traveling together means the whole trip: the same outbound and return flights, including every connecting segment, and the shared destination stay. This supersedes the earlier idea of supporting selected portions of a trip.
- Within a party, members with the same home city depart from the same airport.
- Members with different home cities choose a shared origin. Getting to that origin is outside this planner's scope.
- Each travel party has one shared preference set and a travel leader. Individual mandatory requirements still apply to every proposed party itinerary.
- The party leader accepts proposed constraint changes. The system must not silently relax mandatory requirements.

## 2. Constraint semantics and input

Support both structured input and natural language. An agentic translator using the OpenAI API will translate natural language into structured constraints.

Examples include required presence at the destination, departure and return flexibility, traveling with another user, nonstop-only flights, airline preferences, and excluded layover locations.

| Concept | Agreed meaning |
| --- | --- |
| Required presence in City A between X and Y | Arrive on or before X and depart on day Y or later, using destination-local dates. |
| Date flexibility | Apply independently to departure and return. |
| Date input | Accept either preferred dates with a separate ±N-day flexibility for each end, or explicit earliest/latest departure and return windows. |
| Direct flights | Nonstop flights. |
| Layover exclusions | Support an airport, city, country, or named region such as “Middle East.” |
| Traveling with another user | Share the entire round-trip flight itinerary and destination stay. |
| Mandatory constraints | Exclude violating itineraries; suggest explicit relaxations when needed. |
| Preferences | Rank feasible itineraries using the travel party's shared preferences. |

A required presence interval is not a departure/return search window. For example, presence in Paris June 10–12 permits arrival much earlier and departure much later unless additional bounds are supplied.

Flight departure dates alone cannot establish presence compliance. Returned arrival and departure timestamps must be checked, including overnight flights and time-zone changes. A return flight's departure date is also distinct from its arrival date back home.

### Recommended normalization behavior

- Preserve the original input, constraint owner, scope, and structured interpretation so explanations can refer to what the user entered.
- Separate mandatory requirements from preferences. Do not discard contradictions while normalizing input.
- Show natural-language translations for confirmation before they affect planning; clarify ambiguous dates and locations.
- Give named regions inspectable country definitions and retain the interpretation used by an existing constraint.
- Keep natural-language interpretation separate from deterministic constraint validation and fare scoring.

These normalization and confirmation details are recommendations, not yet fully specified interfaces.

## 3. Planning pipeline

The intended pipeline is:

**Normalize constraints → validate parties and requirements → enumerate bounded candidate date pairs → select up to the configured limit → retrieve cached or fresh fares → validate actual itineraries → rank feasible results per party.**

### A. Normalize and validate

Translate input into predicates that can be evaluated by the solver. Check for contradictory requirements and unresolved party membership or origin information before spending on fare searches.

Users who must travel together can be treated as one search party once membership and a shared origin are resolved. Combine their mandatory requirements and apply the party's shared preferences.

Whole-trip togetherness is transitive: if A must travel with B and B with C, their requirements imply a common party. How such requests reconcile with the owner's authority to manage membership remains an open question; do not silently move users between parties.

### B. Generate candidate dates

Use a constraint solver to derive departure/return date pairs within the supplied bounds. Eliminate combinations ruled out by known date constraints before applying the search cap.

These pairs are candidates, not proof of flight feasibility. Actual flight times and other itinerary details are only available after fare retrieval. Do not claim that date-level feasibility guarantees satisfaction of the required destination stay.

The solver library and formal constraint representation have not been selected.

### C. Search and persist fares

For each selected date pair and travel party, call the Ignav round-trip fare API unless suitable fresh cached results already exist.

Persist fare-search requests and responses separately from their party-specific evaluation and scores. This allows reuse and rescoring when changed constraints do not require different fare data.

### D. Validate and rank

Check returned flight segments against every mandatory requirement, including presence dates, nonstop requirements, layover exclusions, and party togetherness. Rank only feasible itineraries using cost and party preferences such as stops, duration, and airline preference.

Return an ordered list for each party. Independent party ranking is sufficient under the current model, which has no additional coordination constraints between separate parties.

The ranking formula, preference weights, and tie-breaking rules remain open.

### E. Explain outcomes

Distinguish:

- Contradictory modeled requirements.
- No matching fares among the dates searched and options returned.
- An incomplete search caused by API failures.

Only the first establishes a conflict in the modeled requirements. Empty or limited provider results do not prove that no real-world itinerary exists.

When suggesting a relaxation, identify the affected requirements and users and have the party leader accept the change before applying it. The policy for choosing which relaxations to suggest remains open.

## 4. Search-cost policy — agreed initial behavior

- Default to **20 date pairs per travel party per planning run**. Make the limit configurable so it can be raised or lowered later.
- Filter out pairs violating known date constraints before applying the cap.
- If more pairs remain, select those closest to the preferred departure and return dates. Distance is the sum of the absolute departure and return deviations in days.
- For explicit windows without preferred dates, use the window midpoints as ranking anchors.
- A selected pair with sufficiently fresh cached fares counts toward the 20-pair coverage limit but requires no new fare-search call. The cap limits searched pairs, not just cache misses.
- Show coverage, for example: “Searched 20 of 81 eligible date pairs.” Distinguish selected, completed, and failed searches where necessary.
- Date proximity chooses which pairs to search. It does not by itself determine the final ranking of returned fares.

Five possible departure dates and four possible return dates produce 20 pairs. Flexibility of ±4 days at both ends produces 9 × 9 = 81 pairs before filtering; ±5 days produces 121. Wider flexibility remains allowed, but only the closest pairs up to the cap are searched.

This policy can miss cheaper fares farther from the preferred dates. The interface must describe results as the best options found within the searched subset, not an exhaustive optimum.

Boundary tie-breaking, automatic replacement of failed or empty searches, and whether such replacements are permitted within one run are not yet specified. Do not assume automatic expansion beyond the configured cap.

## 5. Ignav integration and caching

The following findings were checked against Ignav's public documentation on 2026-09-19:

- Round-trip results contain outbound choices and compatible returns, not every possible flight combination. Search prices are not reserved fares or guarantees of one combined ticket. See the [round-trip API documentation](https://ignav.com/docs/round-trip).
- Requests include origin, destination, dates, passenger counts, cabin, pricing market, and optional filters. Passenger composition matters; a single-passenger search multiplied by party size is not an equivalent group search. The documented maximum is nine passengers per request. See the [request parameters](https://ignav.com/docs/one-way).
- Ignav recommends caching identical fare searches for minutes and avoiding cached results older than a few hours for live fare use. Empty itinerary lists are valid successful responses. See the [production and caching guidance](https://ignav.com/docs/production-checklist).

### Recommended cache design

- Identify reusable searches by their normalized provider request, including every parameter that changes results; do not key only by dates or party ID.
- Store retrieval time and enough request provenance to explain coverage. Separate historical persistence from eligibility for fresh-price reuse.
- Re-score existing results when only ranking preferences change and the cached search still covers the required request.
- Re-evaluate mandatory constraints against cached itineraries when possible. Relaxing a filter used in the original API request may require a new search because excluded fares were never retrieved.
- Do not assume a broader provider search is exhaustive or equivalent to a narrower follow-up query.
- Deduplicate identical in-flight requests and reuse eligible results across runs where appropriate.

The exact freshness window, retention policy, provider-filter strategy, retry policy, concurrency limits, and handling of parties larger than the provider's passenger limit remain open. The 20-pair cap is not a complete budget for retries, ancillary API calls, or repeated planning runs.

## 6. Remaining decisions

| Area | Unanswered question or recommended direction |
| --- | --- |
| Membership conflicts | What happens when a “travel with” constraint disagrees with assigned parties? Recommendation: flag the conflict for the owner rather than moving users automatically. |
| Party lifecycle | Who appoints or replaces the leader? How are unassigned travelers handled? |
| Permissions | Who can edit individual constraints, shared preferences, and the destination, or initiate paid planning runs? |
| Relaxation authority | The leader accepts changes, but do affected members also need to approve changes to their individual mandatory requirements? |
| Ranking | How should price, stops, total duration, and airline preferences trade off? What is the stable ordering for tied scores? |
| Relaxation selection | Prefer fewer changed rules, fewer shifted days, user-assigned importance, or another measure? |
| Location resolution | How are home cities mapped to selectable origins and airports? How is the shared departure airport selected? |
| Date precision | Are airport arrival/departure dates sufficient, or will users need times of day and airport-to-city travel buffers? |
| Natural-language translation | Define the structured vocabulary, confirmation flow, handling of ambiguity, and invalid or unsupported requests. |
| Region definitions | Choose the geographic source, inspectable membership, and versioning behavior for named areas. |
| Travelers | Must all passengers have accounts? Are guests and children supported? |
| Accounts and invitations | Google and personal Microsoft accounts are the initial sign-in providers. Define identity linking across providers, invitation acceptance, discovery, and visibility of user profiles and trip constraints. |
| Persistence | Choose the database and durable representations for users, trips, membership, constraints, runs, fare data, and scores. |
| Concurrent edits | Recommendation: plan against an input snapshot and label results outdated if constraints or membership change during a run. |
| Search operations | Set cache freshness, retries, timeouts, partial-result behavior, per-run tie-breaking, and limits across repeated runs. |

## 7. Scenarios to validate when implementing

- Create a trip with only a name; add its destination, members, and constraints later.
- Combine individual mandatory constraints within a party and explain contradictions without relaxing them automatically.
- Search a shared origin for members with different home cities without planning their positioning travel.
- Convert both date-input styles into bounded ranges and apply departure and return flexibility independently.
- Reject an overnight flight that arrives after X even when its departure date appeared acceptable.
- Select the nearest 20 eligible pairs, reuse cached selected pairs, and disclose limited coverage.
- Re-score after a preference change without a new fare call when cached data remains suitable; search again when the needed request changes.
- Enforce nonstop and airport/city/country/region layover exclusions using actual itinerary segments.
- Keep contradictory requirements, no returned matches, and provider failures as distinct outcomes.
- Require explicit leader acceptance of proposed relaxations and avoid presenting stale-input results as current.

## 8. Maintaining this document

Update confirmed decisions and the corresponding open questions together as the design evolves. Keep recommendations distinguishable from accepted requirements. Record substantive scope changes here rather than relying on conversation history.
