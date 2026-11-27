namespace TripPlanner.SeedDatabase;

internal sealed record SeedActivity(
    string Name,
    double Latitude,
    double Longitude,
    int DurationMinutes,
    string Kind,
    string Description
);

internal static class SeedActivityCatalog
{
    public static IReadOnlyList<SeedActivity> ForCity(string cityId) =>
        ActivitiesByCity.GetValueOrDefault(cityId, []);

    // Map points represent the venue or the start of a walk, rather than a specific entrance.
    private static readonly Dictionary<string, SeedActivity[]> ActivitiesByCity = new(
        StringComparer.Ordinal
    )
    {
        ["new-york-us"] =
        [
            new(
                "The Metropolitan Museum of Art",
                40.7794,
                -73.9632,
                180,
                "Museum",
                "Choose a handful of galleries, including the Temple of Dendur and the American Wing."
            ),
            new(
                "Central Park Bow Bridge walk",
                40.7759,
                -73.9730,
                75,
                "Walk",
                "Follow the lake paths between Bethesda Terrace and Bow Bridge."
            ),
            new(
                "The Museum of Modern Art",
                40.7614,
                -73.9776,
                120,
                "Museum",
                "See the painting and design galleries and take a break in the sculpture garden."
            ),
            new(
                "High Line walk",
                40.7398,
                -74.0089,
                75,
                "Walk",
                "Start at Gansevoort Street and head north along the elevated railway park."
            ),
            new(
                "Whitney Museum of American Art",
                40.7396,
                -74.0089,
                105,
                "Museum",
                "Browse the American art collections and look out over the Hudson from the terraces."
            ),
            new(
                "Chelsea Market lunch",
                40.7424,
                -74.0061,
                60,
                "Food",
                "Pick up lunch from the food hall and explore the former factory building."
            ),
            new(
                "Grand Central Terminal",
                40.7527,
                -73.9772,
                30,
                "Architecture",
                "Look up at the Main Concourse ceiling and find the Whispering Gallery downstairs."
            ),
            new(
                "New York Public Library and Bryant Park",
                40.7532,
                -73.9822,
                60,
                "Architecture",
                "See the library's marble entry hall and take a break in Bryant Park."
            ),
            new(
                "Brooklyn Bridge walk",
                40.7126,
                -74.0049,
                60,
                "Walk",
                "Cross from City Hall to Brooklyn and pause for skyline photos along the pedestrian path."
            ),
            new(
                "Brooklyn Bridge Park",
                40.7025,
                -73.9952,
                75,
                "Park",
                "Follow the waterfront piers from DUMBO toward Brooklyn Heights."
            ),
            new(
                "Tenement Museum",
                40.7188,
                -73.9900,
                90,
                "History",
                "Join a guided visit to learn how immigrant families lived on the Lower East Side."
            ),
            new(
                "Katz's Delicatessen",
                40.7223,
                -73.9874,
                60,
                "Food",
                "Share a pastrami sandwich and leave time for the lunch queue."
            ),
            new(
                "Staten Island Ferry ride",
                40.7010,
                -74.0132,
                90,
                "Boat ride",
                "Take a round trip from Whitehall Terminal for harbor views and a look at the Statue of Liberty."
            ),
            new(
                "One World Observatory",
                40.7130,
                -74.0132,
                75,
                "Viewpoint",
                "Look across both rivers from the indoor observation deck."
            ),
            new(
                "Washington Square Park and Greenwich Village",
                40.7308,
                -73.9973,
                60,
                "Walk",
                "Start at the arch and meander past the neighborhood's brownstones and small shops."
            ),
        ],
        ["london-gb"] =
        [
            new(
                "British Museum",
                51.5194,
                -0.1270,
                150,
                "Museum",
                "Explore the Egyptian galleries and take a break in the Great Court."
            ),
            new(
                "Tower of London",
                51.5081,
                -0.0759,
                150,
                "History",
                "Visit the White Tower, walk the grounds, and allow time for the Crown Jewels."
            ),
            new(
                "Tower Bridge exhibition",
                51.5055,
                -0.0754,
                75,
                "Architecture",
                "Cross the high-level walkways and visit the Victorian engine rooms."
            ),
            new(
                "Borough Market lunch",
                51.5055,
                -0.0910,
                60,
                "Food",
                "Browse the produce and cheese stalls and choose something for lunch."
            ),
            new(
                "Tate Modern",
                51.5076,
                -0.0994,
                120,
                "Museum",
                "Explore a few modern art galleries and take in the scale of the Turbine Hall."
            ),
            new(
                "South Bank riverside walk",
                51.5062,
                -0.1162,
                75,
                "Walk",
                "Follow the Thames path from the Southbank Centre toward Blackfriars Bridge."
            ),
            new(
                "Westminster Abbey",
                51.4993,
                -0.1273,
                90,
                "History",
                "See the nave, Poets' Corner, and the medieval cloisters."
            ),
            new(
                "St James's Park walk",
                51.5020,
                -0.1348,
                45,
                "Park",
                "Loop around the lake and stop on the bridge for a view toward Buckingham Palace."
            ),
            new(
                "National Gallery",
                51.5089,
                -0.1283,
                90,
                "Museum",
                "Choose a few rooms of European paintings, starting with the Impressionists."
            ),
            new(
                "Covent Garden",
                51.5117,
                -0.1240,
                60,
                "Market",
                "Browse the covered market and linger in the piazza for street performances."
            ),
            new(
                "Victoria and Albert Museum",
                51.4967,
                -0.1722,
                120,
                "Museum",
                "Pick a route through the fashion, decorative arts, and design galleries."
            ),
            new(
                "Natural History Museum",
                51.4967,
                -0.1764,
                120,
                "Museum",
                "See the blue whale skeleton in Hintze Hall and explore the dinosaur galleries."
            ),
            new(
                "Kensington Gardens",
                51.5068,
                -0.1800,
                75,
                "Park",
                "Walk around the Round Pond and continue toward the Italian Gardens."
            ),
            new(
                "Greenwich Park viewpoint",
                51.4775,
                -0.0003,
                75,
                "Viewpoint",
                "Climb the hill near the Royal Observatory for views across the Thames."
            ),
            new(
                "Camden Lock Market",
                51.5416,
                -0.1469,
                90,
                "Market",
                "Browse the market stalls and pause for a snack beside Regent's Canal."
            ),
        ],
        ["rome-it"] =
        [
            new(
                "Colosseum",
                41.8902,
                12.4922,
                90,
                "History",
                "Explore the amphitheater and read about how spectators entered and moved through it."
            ),
            new(
                "Roman Forum and Palatine Hill",
                41.8925,
                12.4853,
                150,
                "History",
                "Walk among the Forum ruins and climb Palatine Hill for a view of the ancient city."
            ),
            new(
                "Pantheon",
                41.8986,
                12.4769,
                45,
                "Architecture",
                "Stand beneath the dome to see how daylight moves through the open oculus."
            ),
            new(
                "Piazza Navona",
                41.8992,
                12.4731,
                30,
                "Architecture",
                "Circle the square and look for the figures on Bernini's Fountain of the Four Rivers."
            ),
            new(
                "Trevi Fountain",
                41.9009,
                12.4833,
                30,
                "Architecture",
                "See the fountain's sculpture and waterworks from the edge of the piazza."
            ),
            new(
                "Spanish Steps and Pincian Hill",
                41.9060,
                12.4828,
                60,
                "Walk",
                "Climb from Piazza di Spagna and continue toward the terrace above Piazza del Popolo."
            ),
            new(
                "Borghese Gallery",
                41.9142,
                12.4922,
                120,
                "Museum",
                "Set aside a timed visit for Bernini's sculptures and Caravaggio's paintings."
            ),
            new(
                "Villa Borghese gardens",
                41.9123,
                12.4853,
                75,
                "Park",
                "Follow the garden paths around the lake and find a shady spot to sit."
            ),
            new(
                "Capitoline Museums",
                41.8933,
                12.4829,
                120,
                "Museum",
                "Visit the sculpture galleries and look down on the Forum from the Tabularium."
            ),
            new(
                "Campo de' Fiori market",
                41.8956,
                12.4722,
                45,
                "Market",
                "Browse the produce and spice stalls and pick up ingredients for a picnic."
            ),
            new(
                "Trastevere evening walk",
                41.8897,
                12.4706,
                75,
                "Walk",
                "Start at Santa Maria in Trastevere and wander the small streets around the square."
            ),
            new(
                "Testaccio Market lunch",
                41.8765,
                12.4741,
                60,
                "Food",
                "Try a Roman-style sandwich and pick up seasonal produce from the covered market."
            ),
            new(
                "Castel Sant'Angelo",
                41.9031,
                12.4663,
                90,
                "History",
                "Climb through the former fortress to the terrace overlooking the Tiber."
            ),
            new(
                "Baths of Caracalla",
                41.8791,
                12.4924,
                90,
                "History",
                "Explore the remains of the bathing rooms and the large open-air exercise spaces."
            ),
            new(
                "Orange Garden viewpoint",
                41.8852,
                12.4791,
                45,
                "Viewpoint",
                "Walk through the Aventine garden to the lookout above the river."
            ),
        ],
        ["istanbul-tr"] =
        [
            new(
                "Hagia Sophia",
                41.0086,
                28.9802,
                75,
                "History",
                "See the great dome and look for surviving Byzantine mosaics in the visitor areas."
            ),
            new(
                "Blue Mosque",
                41.0054,
                28.9768,
                45,
                "Architecture",
                "Study the courtyard and tiled interior around a public visiting period."
            ),
            new(
                "Basilica Cistern",
                41.0084,
                28.9779,
                45,
                "History",
                "Follow the raised paths between the columns and look for the Medusa bases."
            ),
            new(
                "Topkapı Palace",
                41.0115,
                28.9833,
                180,
                "History",
                "Walk through the palace courtyards and choose a few rooms of Ottoman collections."
            ),
            new(
                "Istanbul Archaeology Museums",
                41.0117,
                28.9813,
                120,
                "Museum",
                "See the carved sarcophagi and browse the ancient sculpture galleries."
            ),
            new(
                "Gülhane Park",
                41.0138,
                28.9815,
                45,
                "Park",
                "Walk the shaded paths below Topkapı Palace and pause among the gardens."
            ),
            new(
                "Grand Bazaar",
                41.0107,
                28.9681,
                90,
                "Market",
                "Explore the covered lanes for textiles, ceramics, and small craft shops."
            ),
            new(
                "Spice Bazaar",
                41.0164,
                28.9704,
                45,
                "Market",
                "Browse the stalls for dried fruit, spices, and Turkish delight."
            ),
            new(
                "Süleymaniye Mosque",
                41.0162,
                28.9639,
                60,
                "Architecture",
                "Take in the mosque's courtyard and the view over the Golden Horn."
            ),
            new(
                "Galata Tower",
                41.0257,
                28.9741,
                75,
                "Viewpoint",
                "Look out over the old city and the meeting of the Golden Horn and Bosphorus."
            ),
            new(
                "İstiklal Avenue walk",
                41.0339,
                28.9774,
                75,
                "Walk",
                "Explore the avenue's passages, bookshops, and historic buildings on foot."
            ),
            new(
                "Istanbul Modern",
                41.0269,
                28.9837,
                105,
                "Museum",
                "Browse the Turkish modern art collections and look across the harbor."
            ),
            new(
                "Bosphorus ferry to Kadıköy",
                41.0169,
                28.9782,
                60,
                "Boat ride",
                "Take a ferry from Eminönü for skyline views on the way to the Asian side."
            ),
            new(
                "Kadıköy Market lunch",
                40.9894,
                29.0258,
                75,
                "Food",
                "Explore the fish and produce lanes and stop for a meal at a neighborhood lokanta."
            ),
            new(
                "Balat neighborhood walk",
                41.0290,
                28.9479,
                75,
                "Walk",
                "Explore the steep streets, neighborhood bakeries, and old storefronts around Balat."
            ),
        ],
        ["hong-kong-hk"] =
        [
            new(
                "Victoria Peak and Lugard Road",
                22.2709,
                114.1498,
                120,
                "Viewpoint",
                "Start near the Peak Tram terminus and follow Lugard Road for harbor views."
            ),
            new(
                "Star Ferry crossing",
                22.2941,
                114.1687,
                30,
                "Boat ride",
                "Cross Victoria Harbour from Tsim Sha Tsui to Central on the upper deck."
            ),
            new(
                "Tsim Sha Tsui waterfront walk",
                22.2932,
                114.1745,
                60,
                "Walk",
                "Follow the promenade from the Avenue of Stars toward the Clock Tower."
            ),
            new(
                "M+ museum",
                22.3010,
                114.1595,
                120,
                "Museum",
                "Explore a selection of galleries focused on visual art, design, and moving images."
            ),
            new(
                "Hong Kong Palace Museum",
                22.3015,
                114.1555,
                120,
                "Museum",
                "Choose a few galleries of ceramics, paintings, and imperial objects."
            ),
            new(
                "Tai Kwun heritage courtyards",
                22.2813,
                114.1543,
                90,
                "History",
                "Visit the former police compound and explore its courtyards and galleries."
            ),
            new(
                "Man Mo Temple",
                22.2839,
                114.1502,
                30,
                "Architecture",
                "See the hanging incense coils and carved details in the Sheung Wan temple."
            ),
            new(
                "PMQ design shops",
                22.2831,
                114.1526,
                60,
                "Shopping",
                "Browse local design studios in the former Police Married Quarters."
            ),
            new(
                "Hong Kong Park",
                22.2772,
                114.1618,
                60,
                "Park",
                "Follow the paths around the pond and stop by the aviary if it is open."
            ),
            new(
                "Central dim sum lunch",
                22.2845,
                114.1547,
                60,
                "Food",
                "Pick a teahouse near the Central Market and share a few baskets of dim sum."
            ),
            new(
                "Temple Street night market",
                22.3067,
                114.1700,
                75,
                "Market",
                "Browse the evening stalls and stop for a snack in Yau Ma Tei."
            ),
            new(
                "Nan Lian Garden",
                22.3400,
                114.2048,
                60,
                "Park",
                "Walk past the ponds, rock arrangements, and timber pavilions in Diamond Hill."
            ),
            new(
                "Wong Tai Sin Temple",
                22.3426,
                114.1936,
                45,
                "Architecture",
                "Explore the courtyards and gardens around the main temple hall."
            ),
            new(
                "Tian Tan Buddha",
                22.2539,
                113.9049,
                120,
                "History",
                "Explore the Ngong Ping plateau and climb the steps to the statue's terrace."
            ),
            new(
                "Tai O fishing village walk",
                22.2537,
                113.8630,
                90,
                "Walk",
                "Follow the lanes and footbridges for views of the stilt houses and tidal channels."
            ),
        ],
        ["seoul-kr"] =
        [
            new(
                "Gyeongbokgung Palace",
                37.5796,
                126.9770,
                120,
                "History",
                "Walk through the main courtyards and make time for the pavilion by the pond."
            ),
            new(
                "Changdeokgung Palace",
                37.5794,
                126.9910,
                120,
                "History",
                "Explore the royal halls and consider a separate visit to the Secret Garden."
            ),
            new(
                "Bukchon Hanok Village",
                37.5826,
                126.9830,
                60,
                "Walk",
                "Follow the public lanes past traditional houses during neighborhood visiting hours."
            ),
            new(
                "Insadong tea and craft shops",
                37.5735,
                126.9854,
                75,
                "Shopping",
                "Browse ceramics and paper shops, then stop for tea in a side street."
            ),
            new(
                "Jogyesa Temple",
                37.5744,
                126.9827,
                35,
                "Architecture",
                "Look at the painted main hall and the old trees in the temple courtyard."
            ),
            new(
                "Cheonggyecheon stream walk",
                37.5691,
                126.9787,
                75,
                "Walk",
                "Start at Cheonggye Plaza and follow the paths below street level eastward."
            ),
            new(
                "Gwangjang Market lunch",
                37.5701,
                126.9997,
                60,
                "Food",
                "Try mung bean pancakes and small seaweed rice rolls from the market stalls."
            ),
            new(
                "Dongdaemun Design Plaza",
                37.5667,
                127.0095,
                90,
                "Architecture",
                "Walk around the curved exterior and see what is on display in the design spaces."
            ),
            new(
                "Namsan Seoul Tower",
                37.5512,
                126.9882,
                90,
                "Viewpoint",
                "Spend time on the hilltop terraces and look out over the city from Namsan."
            ),
            new(
                "National Museum of Korea",
                37.5240,
                126.9804,
                150,
                "Museum",
                "Choose several galleries of Korean ceramics, sculpture, and archaeological finds."
            ),
            new(
                "War Memorial of Korea",
                37.5366,
                126.9771,
                120,
                "Museum",
                "Visit the Korean War galleries and spend time among the outdoor memorials."
            ),
            new(
                "Seodaemun Prison History Hall",
                37.5743,
                126.9560,
                90,
                "History",
                "Learn about Korea's independence movement while walking through the preserved prison buildings."
            ),
            new(
                "Seoul Forest",
                37.5445,
                127.0372,
                75,
                "Park",
                "Follow the paths through the woodland and around the ponds."
            ),
            new(
                "Seoullo 7017 walk",
                37.5568,
                126.9720,
                45,
                "Walk",
                "Cross the planted former overpass and look out over the rail lines near Seoul Station."
            ),
            new(
                "Seokchon Lake loop",
                37.5098,
                127.1006,
                60,
                "Park",
                "Walk the lakeside paths in Jamsil and take in the view of the surrounding skyline."
            ),
        ],
        ["tokyo-jp"] =
        [
            new(
                "Sensō-ji Temple",
                35.7148,
                139.7967,
                75,
                "History",
                "Approach the temple through Nakamise and visit the grounds around the main hall."
            ),
            new(
                "Tokyo National Museum",
                35.7188,
                139.7765,
                150,
                "Museum",
                "Spend time with Japanese ceramics, textiles, and sculpture in the main building."
            ),
            new(
                "Ueno Park walk",
                35.7156,
                139.7745,
                60,
                "Park",
                "Walk the main avenue and continue toward the paths around Shinobazu Pond."
            ),
            new(
                "Ameyoko market snacks",
                35.7098,
                139.7744,
                60,
                "Market",
                "Explore the shopping lanes under the tracks and pick up a snack."
            ),
            new(
                "Tokyo Skytree observation decks",
                35.7101,
                139.8107,
                90,
                "Viewpoint",
                "Look for the Sumida River and distant mountains from the observation deck."
            ),
            new(
                "Tsukiji Outer Market breakfast",
                35.6654,
                139.7707,
                75,
                "Food",
                "Sample a few bites from the shops and seafood counters in the market lanes."
            ),
            new(
                "Hama-rikyū Gardens",
                35.6599,
                139.7635,
                75,
                "Park",
                "Follow the tidal pond and stop at the teahouse in the garden."
            ),
            new(
                "Imperial Palace East Gardens",
                35.6855,
                139.7563,
                90,
                "Park",
                "Walk past the former castle walls, stone foundations, and landscaped gardens."
            ),
            new(
                "Meiji Jingū shrine",
                35.6764,
                139.6993,
                75,
                "Architecture",
                "Follow the wooded approach beneath the torii gates to the main courtyard."
            ),
            new(
                "Shibuya Crossing and Hachikō",
                35.6595,
                139.7006,
                40,
                "Walk",
                "Meet by the Hachikō statue, cross the scramble, and explore the streets near the station."
            ),
            new(
                "Shinjuku Gyoen",
                35.6852,
                139.7101,
                90,
                "Park",
                "Walk through the garden's open lawns, ponds, and landscaped Japanese gardens."
            ),
            new(
                "Tokyo Metropolitan Government Building",
                35.6896,
                139.6921,
                60,
                "Viewpoint",
                "Ride up to a public observation room and look across western Tokyo."
            ),
            new(
                "Nezu Museum",
                35.6622,
                139.7170,
                105,
                "Museum",
                "Pair the East Asian art galleries with a quiet walk in the museum garden."
            ),
            new(
                "Akihabara electronics and hobby shops",
                35.6984,
                139.7715,
                90,
                "Shopping",
                "Browse the electronics shops and hobby stores around Chūō-dōri."
            ),
            new(
                "Nakano Broadway",
                35.7092,
                139.6658,
                90,
                "Shopping",
                "Explore the indoor floors of second-hand manga, collectibles, and specialty shops."
            ),
        ],
        ["sydney-au"] =
        [
            new(
                "Sydney Opera House tour",
                -33.8568,
                151.2153,
                75,
                "Architecture",
                "Join a tour to see inside the building and learn how its distinctive roofs were made."
            ),
            new(
                "Sydney Harbour Bridge walk",
                -33.8582,
                151.2082,
                60,
                "Walk",
                "Start near the southern stairs and cross on the pedestrian path for harbor views."
            ),
            new(
                "The Rocks heritage walk",
                -33.8597,
                151.2082,
                75,
                "History",
                "Explore the sandstone lanes, old warehouses, and small courtyards above the waterfront."
            ),
            new(
                "Royal Botanic Garden Sydney",
                -33.8642,
                151.2172,
                90,
                "Park",
                "Walk through the planted collections and follow the harbor path toward Mrs Macquarie's Chair."
            ),
            new(
                "Art Gallery of New South Wales",
                -33.8688,
                151.2174,
                120,
                "Museum",
                "Browse Australian and international art in the gallery buildings beside the Domain."
            ),
            new(
                "Australian Museum",
                -33.8743,
                151.2133,
                105,
                "Museum",
                "Explore natural history collections and exhibitions on First Nations cultures."
            ),
            new(
                "Queen Victoria Building",
                -33.8716,
                151.2068,
                45,
                "Architecture",
                "Browse the shops and look up at the stained glass, clocks, and central dome."
            ),
            new(
                "Hyde Park and ANZAC Memorial",
                -33.8755,
                151.2113,
                60,
                "History",
                "Walk the tree-lined paths and visit the memorial at the southern end of the park."
            ),
            new(
                "Australian National Maritime Museum",
                -33.8699,
                151.1986,
                120,
                "Museum",
                "Explore the harbor exhibits and make time for vessels that are open to visitors."
            ),
            new(
                "Chinese Garden of Friendship",
                -33.8761,
                151.2024,
                60,
                "Park",
                "Follow the paths around the pond and through the garden's covered pavilions."
            ),
            new(
                "Paddy's Markets Haymarket",
                -33.8797,
                151.2049,
                60,
                "Market",
                "Browse the produce and souvenir stalls under Market City."
            ),
            new(
                "Manly Ferry ride",
                -33.8613,
                151.2109,
                45,
                "Boat ride",
                "Leave Circular Quay by ferry and watch for headlands and coves on the way to Manly."
            ),
            new(
                "Manly Beach and Shelly Beach walk",
                -33.7970,
                151.2881,
                90,
                "Walk",
                "Follow the paved foreshore path from Manly to Shelly Beach and back."
            ),
            new(
                "Bondi to Coogee coastal walk",
                -33.8949,
                151.2745,
                150,
                "Walk",
                "Follow the clifftop path past Tamarama and Bronte, with time for water and photo stops."
            ),
            new(
                "Taronga Zoo Sydney",
                -33.8434,
                151.2412,
                180,
                "Wildlife",
                "Spend a few hours at the habitat exhibits on the hillside overlooking the harbor."
            ),
        ],
        ["honolulu-us"] =
        [
            new(
                "Diamond Head crater hike",
                21.2668,
                -157.8020,
                120,
                "Hike",
                "Start inside the crater and climb the switchbacks and steps to the lookout."
            ),
            new(
                "Waikīkī Beach",
                21.2753,
                -157.8270,
                90,
                "Beach",
                "Spend time on the sand near Kūhiō Beach and watch the surfers offshore."
            ),
            new(
                "ʻIolani Palace",
                21.3069,
                -157.8588,
                90,
                "History",
                "See the restored rooms and learn about the Hawaiian monarchy on a palace tour."
            ),
            new(
                "Bishop Museum",
                21.3334,
                -157.8707,
                150,
                "Museum",
                "Explore Hawaiian Hall and the collections about the Pacific and its cultures."
            ),
            new(
                "Honolulu Museum of Art",
                21.3040,
                -157.8488,
                105,
                "Museum",
                "Browse a few galleries and take a break in the museum's open courtyards."
            ),
            new(
                "Chinatown market walk",
                21.3124,
                -157.8625,
                75,
                "Market",
                "Browse the produce shops and bakeries around Maunakea Street."
            ),
            new(
                "Foster Botanical Garden",
                21.3161,
                -157.8588,
                75,
                "Park",
                "Walk through the collection of mature tropical trees and visit the conservatory."
            ),
            new(
                "Ala Moana Beach Park picnic",
                21.2897,
                -157.8489,
                90,
                "Park",
                "Pick up a picnic and settle on the lawn near the waterfront."
            ),
            new(
                "Kakaʻako Waterfront Park",
                21.2917,
                -157.8658,
                60,
                "Walk",
                "Follow paths over the grassy rises and look out along the south shore."
            ),
            new(
                "Kapiʻolani Park stroll",
                21.2656,
                -157.8184,
                60,
                "Park",
                "Walk under the large trees between the bandstand and the oceanfront."
            ),
            new(
                "Waikīkī Aquarium",
                21.2658,
                -157.8217,
                75,
                "Wildlife",
                "Visit the reef exhibits to see the marine life found around the Hawaiian Islands."
            ),
            new(
                "Punchbowl memorial lookout",
                21.3126,
                -157.8451,
                60,
                "History",
                "Visit the memorial grounds and pause at the overlook above downtown."
            ),
            new(
                "Hawaiian Mission Houses",
                21.3045,
                -157.8575,
                75,
                "History",
                "Visit the historic buildings and learn about printing and daily life in early Honolulu."
            ),
            new(
                "Leonard's Bakery malasadas",
                21.2847,
                -157.8137,
                45,
                "Food",
                "Pick up warm malasadas at the Kapahulu bakery and try a couple of fillings."
            ),
            new(
                "Mānoa Falls trail",
                21.3315,
                -157.8013,
                105,
                "Hike",
                "Follow the forest trail to the waterfall viewpoint, allowing extra time if the path is muddy."
            ),
        ],
        ["los-angeles-us"] =
        [
            new(
                "Griffith Observatory",
                34.1184,
                -118.3004,
                105,
                "Viewpoint",
                "Visit the astronomy exhibits and look across the city from the terraces."
            ),
            new(
                "Griffith Park Fern Dell walk",
                34.1095,
                -118.3086,
                60,
                "Walk",
                "Follow the shaded path by the stream and continue uphill for a view of the park."
            ),
            new(
                "Getty Center",
                34.0780,
                -118.4741,
                150,
                "Museum",
                "Choose a few galleries and spend time in the garden and hillside courtyards."
            ),
            new(
                "Los Angeles County Museum of Art",
                34.0639,
                -118.3592,
                120,
                "Museum",
                "Visit the art galleries and walk through the rows of streetlamps outside."
            ),
            new(
                "La Brea Tar Pits",
                34.0638,
                -118.3555,
                90,
                "Museum",
                "See the fossil displays and walk around the excavation areas in Hancock Park."
            ),
            new(
                "Academy Museum of Motion Pictures",
                34.0630,
                -118.3609,
                120,
                "Museum",
                "Browse exhibitions on filmmaking and see the terrace atop the theater building."
            ),
            new(
                "Petersen Automotive Museum",
                34.0625,
                -118.3611,
                105,
                "Museum",
                "Explore the galleries of historic cars and compare their designs across decades."
            ),
            new(
                "Grand Central Market lunch",
                34.0508,
                -118.2488,
                60,
                "Food",
                "Choose lunch from the downtown food stalls and sit in the market hall."
            ),
            new(
                "The Broad",
                34.0545,
                -118.2506,
                90,
                "Museum",
                "Browse the contemporary art galleries in the perforated museum building."
            ),
            new(
                "Walt Disney Concert Hall exterior",
                34.0554,
                -118.2498,
                45,
                "Architecture",
                "Walk around the building to see how its stainless steel curves change from each side."
            ),
            new(
                "Bradbury Building",
                34.0506,
                -118.2479,
                30,
                "Architecture",
                "View the daylight-filled atrium and ironwork from the public lobby."
            ),
            new(
                "Olvera Street",
                34.0570,
                -118.2380,
                75,
                "Market",
                "Explore the market lane and the historic buildings around the old plaza."
            ),
            new(
                "Little Tokyo neighborhood walk",
                34.0495,
                -118.2395,
                75,
                "Walk",
                "Browse the shops around Japanese Village Plaza and stop for a sweet or a cup of tea."
            ),
            new(
                "Venice Canals walk",
                33.9834,
                -118.4672,
                60,
                "Walk",
                "Follow the public paths and footbridges through the residential canals."
            ),
            new(
                "Venice Beach boardwalk",
                33.9850,
                -118.4734,
                75,
                "Beach",
                "Walk the oceanfront past the skatepark and beach courts and settle on the sand."
            ),
        ],
        ["chicago-us"] =
        [
            new(
                "Art Institute of Chicago",
                41.8796,
                -87.6237,
                150,
                "Museum",
                "Choose a few galleries, including the Impressionists and the Thorne Miniature Rooms."
            ),
            new(
                "Millennium Park",
                41.8826,
                -87.6226,
                60,
                "Park",
                "Walk past Cloud Gate, Crown Fountain, and the garden near the concert pavilion."
            ),
            new(
                "Chicago Riverwalk",
                41.8880,
                -87.6265,
                75,
                "Walk",
                "Follow the riverside path past the bascule bridges and downtown towers."
            ),
            new(
                "Chicago River architecture cruise",
                41.8883,
                -87.6248,
                105,
                "Boat ride",
                "Board near Michigan Avenue and learn about the buildings lining the river."
            ),
            new(
                "Chicago Cultural Center",
                41.8837,
                -87.6249,
                60,
                "Architecture",
                "Look up at the stained-glass dome and browse the public exhibition rooms."
            ),
            new(
                "Field Museum",
                41.8663,
                -87.6170,
                150,
                "Museum",
                "See the dinosaur galleries and choose another section of natural history displays."
            ),
            new(
                "Shedd Aquarium",
                41.8676,
                -87.6140,
                120,
                "Wildlife",
                "Explore the freshwater and ocean exhibits on the Museum Campus."
            ),
            new(
                "Adler Planetarium skyline walk",
                41.8665,
                -87.6078,
                45,
                "Viewpoint",
                "Walk out to the lakefront point for a broad view back toward downtown."
            ),
            new(
                "Skydeck Chicago",
                41.8789,
                -87.6359,
                75,
                "Viewpoint",
                "Ride up Willis Tower and look across the grid of streets toward the lake."
            ),
            new(
                "Lincoln Park Zoo",
                41.9211,
                -87.6339,
                120,
                "Wildlife",
                "Walk between the habitat areas and leave time to explore the Nature Boardwalk."
            ),
            new(
                "Lincoln Park Conservatory",
                41.9231,
                -87.6355,
                60,
                "Park",
                "Visit the greenhouse rooms to see the palms, ferns, and orchids."
            ),
            new(
                "Chicago History Museum",
                41.9119,
                -87.6317,
                105,
                "Museum",
                "Explore objects and photographs from Chicago's neighborhoods and transport history."
            ),
            new(
                "National Museum of Mexican Art",
                41.8562,
                -87.6728,
                105,
                "Museum",
                "Visit the galleries in Pilsen to see Mexican and Mexican American art."
            ),
            new(
                "Lou Malnati's deep-dish dinner",
                41.8904,
                -87.6333,
                90,
                "Food",
                "Share a deep-dish pie in River North and allow time for it to bake."
            ),
            new(
                "Garfield Park Conservatory",
                41.8863,
                -87.7171,
                90,
                "Park",
                "Spend time in the large greenhouse rooms, from the fern collection to the desert plants."
            ),
        ],
    };
}
