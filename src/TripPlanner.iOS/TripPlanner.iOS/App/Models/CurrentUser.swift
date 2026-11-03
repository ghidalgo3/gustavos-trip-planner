import Foundation

struct CurrentUser: Codable, Equatable, Sendable {
    let isAuthenticated: Bool
    let id: UUID?
    let name: String?
    let email: String?
    let provider: String?
    let completedOnboarding: Bool
    let profile: UserProfile
}

struct UserProfile: Codable, Equatable, Sendable {
    let homeCity: HomeCity?
    let preferredAirlines: [String]
    let preferredAirport: String?
}

struct HomeCity: Codable, Equatable, Sendable {
    let name: String
    let longitude: Double
    let latitude: Double
}
