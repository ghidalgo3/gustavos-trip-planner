#if DEBUG
import SwiftUI

enum PrototypeSection: String, CaseIterable, Identifiable {
    case destinations = "Destinations"
    case plans = "Plans"
    case flights = "Flights"
    case people = "People"

    var id: Self { self }

    var icon: String {
        switch self {
        case .destinations: "map"
        case .plans: "calendar"
        case .flights: "airplane"
        case .people: "person.2"
        }
    }

    var action: String {
        switch self {
        case .destinations: "Add destination"
        case .plans: "Add activity"
        case .flights: "Find flights"
        case .people: "Invite traveler"
        }
    }

    var samples: [PrototypeRow] {
        switch self {
        case .destinations:
            [PrototypeRow("Tokyo", "Apr 8–11 · 3 nights"),
             PrototypeRow("Kyoto", "Apr 11–15 · 4 nights"),
             PrototypeRow("Osaka", "Apr 15–17 · 2 nights")]
        case .plans:
            [PrototypeRow("Explore Asakusa", "Apr 8 · 3:00 PM · Tokyo", day: 8),
             PrototypeRow("Nishiki Market", "Apr 11 · 12:30 PM · Kyoto", day: 11),
             PrototypeRow("Dinner in Dōtonbori", "Apr 15 · 7:00 PM · Osaka", day: 15)]
        case .flights:
            [PrototypeRow("JFK → HND", "Apr 8 · Outbound"),
             PrototypeRow("KIX → JFK", "Apr 17 · Return")]
        case .people:
            [PrototypeRow("Gustavo", "Organizer"),
             PrototypeRow("Maya Chen", "Accepted"),
             PrototypeRow("Alex Rivera", "Invitation pending")]
        }
    }
}

struct PrototypeRow: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let day: Int?

    init(_ title: String, _ detail: String, day: Int? = nil) {
        self.title = title
        self.detail = detail
        self.day = day
    }
}

@Observable
final class TripPrototypeData {
    var rows: [PrototypeSection: [PrototypeRow]] = [:]
    var editor: PrototypeSection?

    subscript(section: PrototypeSection) -> [PrototypeRow] {
        rows[section, default: []]
    }

    func reset(sample: Bool) {
        rows = Dictionary(uniqueKeysWithValues: PrototypeSection.allCases.map {
            ($0, sample ? $0.samples : [])
        })
    }
}

struct PrototypeTripHeading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Japan in spring")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            Label("April 8–17, 2027", systemImage: "calendar")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PrototypePanel: View {
    let section: PrototypeSection
    let data: TripPrototypeData
    var showsAction = true

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if showsAction {
                ViewThatFits(in: .horizontal) {
                    HStack {
                        heading
                        Spacer(minLength: 12)
                        action
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        heading
                        action
                    }
                }
            } else {
                heading
            }

            if data[section].isEmpty {
                Text("No \(section.rawValue.lowercased()) yet")
                    .foregroundStyle(.secondary)
            }

            ForEach(data[section]) { row in
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.title).font(.headline)
                    Text(row.detail).font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 20))
    }

    private var heading: some View {
        Label(section.rawValue, systemImage: section.icon)
            .font(.title3.bold())
            .accessibilityAddTraits(.isHeader)
    }

    private var action: some View {
        Button(section.action) { data.editor = section }
            .buttonStyle(.bordered)
            .controlSize(.large)
    }
}

struct PrototypeEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var detail = ""
    @State private var didSearch = false
    @State private var day = 8

    let section: PrototypeSection
    let data: TripPrototypeData

    private var fields: (String, String) {
        switch section {
        case .destinations: ("City", "Dates")
        case .plans: ("Activity", "Time and place")
        case .flights: ("From airport", "To airport")
        case .people: ("Email address", "")
        }
    }

    private var cleanedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var cleanedDetail: String { detail.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                TextField(fields.0, text: $name)
                    .textInputAutocapitalization(section == .people ? .never : .sentences)
                    .keyboardType(section == .people ? .emailAddress : .default)
                if section == .plans {
                    Picker("Date", selection: $day) {
                        ForEach(8...17, id: \.self) { day in
                            Text("April \(day)").tag(day)
                        }
                    }
                }
                if section != .people {
                    TextField(fields.1, text: $detail)
                }
                if didSearch {
                    Section("Sample result") {
                        Button {
                            add("\(cleanedName.uppercased()) → \(cleanedDetail.uppercased())",
                                detail: "Shortlisted · Sample flight")
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(cleanedName.uppercased()) → \(cleanedDetail.uppercased())")
                                Text("Nonstop · Add to shortlist")
                                    .font(.subheadline)
                            }
                        }
                    }
                }
            }
            .navigationTitle(section.action)
            .onChange(of: name) { didSearch = false }
            .onChange(of: detail) { didSearch = false }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(section == .flights ? "Search" : "Add") {
                        if section == .flights {
                            didSearch = true
                        } else if section == .plans {
                            add(cleanedName, detail: "Apr \(day) · \(cleanedDetail)", day: day)
                        } else {
                            add(cleanedName, detail: section == .people ? "Invitation pending" : cleanedDetail)
                        }
                    }
                    .disabled(cleanedName.isEmpty || (section == .people
                        ? !cleanedName.contains("@") : cleanedDetail.isEmpty))
                }
            }
        }
    }

    private func add(_ title: String, detail: String, day: Int? = nil) {
        data.rows[section, default: []].append(PrototypeRow(title, detail, day: day))
        dismiss()
    }
}

struct TripDetailPrototypePreview<Content: View>: View {
    @State private var data = TripPrototypeData()
    @State private var sample = true
    @State private var revision = 0
    @State private var columns = NavigationSplitViewVisibility.all

    @ViewBuilder let content: (TripPrototypeData) -> Content

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            List {
                Section("Preview state") {
                    Picker("Data", selection: $sample) {
                        Text("Sample trip").tag(true)
                        Text("Empty trip").tag(false)
                    }
                    Button("Reset preview", systemImage: "arrow.counterclockwise") { reset() }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("Preview")
            .navigationSplitViewColumnWidth(min: 175, ideal: 190, max: 230)
        } detail: {
            content(data)
                .id(revision)
        }
        .sheet(item: $data.editor) { section in
            PrototypeEditor(section: section, data: data)
        }
        .onAppear { reset() }
        .onChange(of: sample) { reset() }
    }

    private func reset() {
        data.reset(sample: sample)
        revision += 1
    }
}

#Preview("Prototype components", traits: .landscapeLeft) {
    TripDetailPrototypePreview { data in
        ScrollView {
            PrototypePanel(section: .destinations, data: data).padding()
        }
        .background(Color(uiColor: .systemGroupedBackground))
    }
}
#endif
