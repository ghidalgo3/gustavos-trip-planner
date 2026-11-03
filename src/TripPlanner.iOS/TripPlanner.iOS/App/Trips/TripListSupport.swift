import SwiftUI

struct TripListMetadata {
    let startDate: Date?
    let endDate: Date?
    let symbol: String
    let inviterName: String?

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func make(for trip: Trip, currentUserID: UUID?) -> TripListMetadata {
        let lowercasedName = trip.name.lowercased()
        let symbol: String

        if lowercasedName.contains("japan") {
            symbol = "camera.macro"
        } else if lowercasedName.contains("lisbon") {
            symbol = "tram.fill"
        } else if lowercasedName.contains("ital") {
            symbol = "sun.max.fill"
        } else if lowercasedName.contains("new york") {
            symbol = "building.2.fill"
        } else if lowercasedName.contains("iceland") {
            symbol = "mountain.2.fill"
        } else {
            symbol = "map.fill"
        }

        let isInvited = trip.ownerUserId.map { $0 != currentUserID } ?? false

        return TripListMetadata(
            startDate: trip.startDate.flatMap { dateFormatter.date(from: $0) },
            endDate: trip.endDate.flatMap { dateFormatter.date(from: $0) },
            symbol: symbol,
            inviterName: isInvited ? "Maya Chen" : nil
        )
    }
}

struct TripListIcon: View {
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.title3)
            .foregroundStyle(.tint)
            .frame(width: 34, height: 34)
            .accessibilityHidden(true)
    }
}

struct TripListDates: View {
    let startDate: Date?
    let endDate: Date?

    var body: some View {
        HStack(spacing: 4) {
            if let startDate {
                Text(startDate, format: .dateTime.month(.abbreviated).day().year())
            }
            if let endDate, endDate != startDate {
                if startDate != nil {
                    Text("–")
                }
                Text(endDate, format: .dateTime.month(.abbreviated).day().year())
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }
}

struct TripListOwnership: View {
    let inviterName: String

    var body: some View {
        Label("From \(inviterName)", systemImage: "shared.with.you")
        .font(.caption.weight(.medium))
        .foregroundStyle(.purple)
    }
}

struct TripListCloudLink: View {
    let tripID: UUID
    @State private var isPresented = false

    private var tripURL: URL {
        OAuthConfiguration().issuer
            .appendingPathComponent("trips")
            .appendingPathComponent(tripID.uuidString.lowercased())
    }

    var body: some View {
        Button("Open on the web", systemImage: "icloud") {
            isPresented = true
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Open trip on the web")
        .popover(isPresented: $isPresented) {
            Link(destination: tripURL) {
                Label("Open in Trip Planner", systemImage: "arrow.up.right.square")
            }
            .buttonStyle(.borderedProminent)
            .padding()
            .presentationCompactAdaptation(.popover)
        }
    }
}
