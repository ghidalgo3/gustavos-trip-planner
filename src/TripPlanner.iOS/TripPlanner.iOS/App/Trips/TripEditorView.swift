import SwiftUI

struct TripEditorView: View {
    let model: AppModel
    let trip: Trip?
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var description: String

    init(model: AppModel, trip: Trip?) {
        self.model = model
        self.trip = trip
        _name = State(initialValue: trip?.name ?? "")
        _description = State(initialValue: trip?.description ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Trip name", text: $name)
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(3...8)
                }
                .disabled(trip.map { !model.canEdit($0) } ?? false)

                if let error = model.errorMessage {
                    Text(error)
                        .foregroundStyle(.red)
                }
            }
            .navigationTitle(trip == nil ? "New trip" : "Trip details")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") {
                        dismiss()
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", systemImage: "checkmark") {
                        Task {
                            if await model.saveTrip(
                                existing: trip,
                                name: name,
                                description: description
                            ) {
                                dismiss()
                            }
                        }
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderedProminent)
                    .disabled(
                        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || (trip.map { !model.canEdit($0) } ?? false)
                    )
                }
            }
        }
    }
}

#Preview("Trip editor") {
    TripPreview { model in
        TripEditorView(model: model, trip: nil)
    }
}
