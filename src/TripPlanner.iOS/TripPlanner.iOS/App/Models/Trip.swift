import Foundation

struct Trip: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let ownerUserId: UUID?
    let canPlan: Bool
    var name: String
    var description: String
    var constraints: JSONValue
    let createdAt: Date
    var updatedAt: Date
    var etag: String? = nil
    var startDate: String? = nil
    var endDate: String? = nil

    var isLocal: Bool { ownerUserId == nil }

    static func local(name: String, description: String) -> Trip {
        let now = Date()
        return Trip(id: UUID(), ownerUserId: nil, canPlan: true, name: name,
                    description: description, constraints: .object([:]), createdAt: now, updatedAt: now)
    }

    func hasSameContent(as other: Trip) -> Bool {
        name == other.name && description == other.description && constraints == other.constraints
    }

    func isOwned(by userID: UUID) -> Bool {
        ownerUserId == userID
    }
}

struct TripInput: Encodable, Sendable {
    let name: String
    let description: String
    let constraints: JSONValue
}

indirect enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}
