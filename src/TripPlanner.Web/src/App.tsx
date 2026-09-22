import { useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  LargeTitle,
  Spinner,
  Subtitle1,
  Text,
  Title3,
} from "@fluentui/react-components";
import { Location24Regular, SignOut24Regular } from "@fluentui/react-icons";
import {
  getCurrentUser,
  loginUrl,
  logoutUrl,
  profileImageUrl,
  type CurrentUser,
} from "./api";
import HomeCityPicker from "./HomeCityPicker";
import TripsDashboard from "./TripsDashboard";

export default function App() {
  const [user, setUser] = useState<CurrentUser>();
  const [apiAvailable, setApiAvailable] = useState(true);

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
      <header className="topbar">
        <div className="brand">
          <Location24Regular />
          <Text weight="semibold" size={400}>
            Trip Planner
          </Text>
        </div>
        {user?.isAuthenticated && (
          <div className="user-actions">
            <Avatar
              name={user.name ?? user.email ?? "Traveler"}
              image={{ src: profileImageUrl() }}
            />
            <Button
              as="a"
              href={logoutUrl()}
              appearance="subtle"
              icon={<SignOut24Regular />}
            >
              Sign out
            </Button>
          </div>
        )}
      </header>

      {user?.isAuthenticated && user.completedOnboarding && user.id ? (
        <TripsDashboard user={{ ...user, id: user.id }} />
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
