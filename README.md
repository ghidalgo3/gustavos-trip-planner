# Gustavo's Trip Planner

Plan trips with other travelers, organize destinations and stays, compare
transportation, and schedule activities. The project includes a React web app,
a SwiftUI iOS app, and a .NET API with PostgreSQL. Production runs on Azure.

## Getting started

- [Local development](docs/local_development.md) covers toolchain setup, running the app, seed data, and test commands.
- [Application architecture](docs/architecture.md) maps the repository and explains the shared trip model.
- [Changelog](CHANGELOG.md) records significant changes. Add new entries under **Unreleased**.
- [Repository conventions](AGENTS.md) cover development, testing, and pull requests.

## Application guides

| Topic | Guide |
| --- | --- |
| Trips, destinations, and accommodation | [Trip overview and stays](docs/trip_overview.md) |
| Transportation between visits | [Transportation resources and route estimates](docs/transportation.md) |
| Fare search, selection, and booking | [Flight planning](docs/flight_planning.md) |
| Ideas, schedules, and calendar subscriptions | [Activity planning](docs/activity_planning.md) |
| Maps, offline use, profile editing, and routing | [Web application](docs/web_app.md) |
| Simulator setup, local storage, and cloud sync | [iOS application](docs/ios_app.md) |
| Maps artwork and licensing | [Place artwork and open source notices](docs/artwork.md) |

## Engineering guides

| Topic | Guide |
| --- | --- |
| Desktop and mobile web journey audits, including planning progress | [UX testing with Codex](docs/ux_testing.md) |
| Endpoints and request validation | [REST API reference](docs/api.md) |
| Portable trip model and JSON Schema | [Trip document](docs/trip_document.md) |
| Storage, migrations, and resource relationships | [PostgreSQL database](docs/database.md) |
| Google and Microsoft sign-in | [Authentication](docs/authentication.md) |
| MCP connections, permissions, and audit history | [ChatGPT MCP access and Activity Log](docs/mcp.md) |
| Travel-agent workflows and behavioral evaluations | [MCP planning and evaluations](docs/mcp_planning.md) |
| Azure provisioning, CI, and deployment | [Azure infrastructure and deployment](docs/deployment.md) |
| Application Insights and request traces | [Telemetry](docs/telemetry.md) |
