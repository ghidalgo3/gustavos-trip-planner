import { useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import {
  Avatar,
  Card,
  CardHeader,
  LargeTitle,
  Spinner,
  Subtitle1,
  Text,
  Title3,
} from "@fluentui/react-components";
import {
  Location24Regular,
  Person24Regular,
  SignOut24Regular,
} from "@fluentui/react-icons";
import {
  getCurrentUser,
  loginUrl,
  logoutUrl,
  profileImageUrl,
  type CurrentUser,
  type UserProfile,
} from "./api";
import HomeCityPicker from "./HomeCityPicker";
import ProfilePage from "./ProfilePage";
import TripsDashboard from "./TripsDashboard";
import TripPlanningPage from "./TripPlanningPage";
import ScrollPositionRestoration from "./ScrollPositionRestoration";

const emptyProfile: UserProfile = { homeCity: null, preferredAirlines: [] };

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<CurrentUser>();
  const [apiAvailable, setApiAvailable] = useState(true);
  const userMenu = useRef<HTMLDetailsElement>(null);
  const profile = user?.profile ?? emptyProfile;

  async function openProfile() {
    try {
      setUser(await getCurrentUser());
    } catch {
      // The route can still render the current session and let the user retry.
    }
    userMenu.current?.removeAttribute("open");
    navigate("/profile");
  }

  useEffect(() => {
    const controller = new AbortController();
    getCurrentUser(controller.signal)
      .then(setUser)
      .catch(() => {
        if (!controller.signal.aborted) {
          setApiAvailable(false);
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <ScrollPositionRestoration />
      <header className="topbar">
        <Link className="brand" to="/">
          <Location24Regular aria-hidden="true" />
          <Text weight="semibold" size={400}>
            Trip Planner
          </Text>
        </Link>
        {user?.isAuthenticated && (
          <div className="user-actions">
            <details className="user-menu" ref={userMenu}>
              <summary aria-label="User profile">
                <Avatar
                  name={user.name ?? user.email ?? "Traveler"}
                  image={{ src: profileImageUrl() }}
                />
                <span>{user.name ?? user.email ?? "Traveler"}</span>
              </summary>
              <div className="user-menu-panel">
                <button type="button" onClick={() => void openProfile()}>
                  <Person24Regular /> Your profile
                </button>
                <a href={logoutUrl()}>
                  <SignOut24Regular /> Sign out
                </a>
              </div>
            </details>
          </div>
        )}
      </header>

      {user?.isAuthenticated &&
      user.id &&
      (user.completedOnboarding || location.pathname === "/profile") ? (
        <Routes>
          <Route
            path="/"
            element={<TripsDashboard user={{ ...user, id: user.id }} />}
          />
          <Route
            path="/trips/:tripId/*"
            element={
              <TripPlanningPage
                userId={user.id}
                homeCity={profile.homeCity?.name ?? null}
                featureFlags={user.featureFlags ?? []}
              />
            }
          />
          <Route
            path="/profile"
            element={
              <ProfilePage user={{ ...user, profile }} onSaved={setUser} />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <section className="hero">
          <div className="hero-copy">
            <Text className="eyebrow" weight="semibold">
              YOUR NEXT STORY STARTS HERE
            </Text>
            <LargeTitle>Make room for the trip, not the busywork.</LargeTitle>
            <Subtitle1>
              Keep destinations, dates, and ideas together in one calm place.
            </Subtitle1>

            {!apiAvailable ? (
              <Text role="alert">
                The API is not available yet. Start the local containers and
                refresh.
              </Text>
            ) : !user ? (
              <Spinner label="Checking your session" />
            ) : user.isAuthenticated ? (
              <div className="welcome" aria-label="Complete your profile">
                <Title3 as="h2">Where do you call home?</Title3>
                <Text>
                  We’ll use your home city as the starting point when planning
                  trips.
                </Text>
                <HomeCityPicker onSaved={setUser} />
              </div>
            ) : (
              <div className="auth-actions" aria-label="Sign in options">
                <a href={loginUrl("google")} className="provider-sign-in">
                  <img
                    src="/auth/sign-in-with-google.svg"
                    alt="Sign in with Google"
                    width="180"
                    height="40"
                  />
                </a>
                <a href={loginUrl("aad")} className="provider-sign-in">
                  <img
                    src="/auth/sign-in-with-microsoft.svg"
                    alt="Sign in with Microsoft"
                    width="215"
                    height="41"
                  />
                </a>
              </div>
            )}
          </div>

          <Card className="postcard" appearance="filled-alternative">
            <CardHeader
              image={
                <div className="postcard-icon">
                  <Location24Regular />
                </div>
              }
              header={<Title3>Everything in one itinerary</Title3>}
              description={
                <Text>
                  Dates, notes, and destinations are ready when inspiration
                  strikes.
                </Text>
              }
            />
            <div className="route" aria-hidden="true">
              <span>Home</span>
              <span className="route-line" />
              <span>Somewhere wonderful</span>
            </div>
          </Card>
        </section>
      )}
    </main>
  );
}
