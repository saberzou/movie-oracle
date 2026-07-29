// Question pool + TMDB genre reference data.
//
// Each question maps its two answers to a TMDB discover filter:
//   genres  — TMDB genre ids, OR-combined at query time
//   yearGte / yearLte — primary_release_date bounds
//   voteAvg — vote_average floor
//
// Answers are index-aligned with `options`, so filters[0] belongs to options[0].

export const GENRE_NAMES = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
    99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
    27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
    53: 'Thriller', 10752: 'War', 37: 'Western',
};

export const QUESTION_POOL = [
    { text: 'Coffee or Tea?', options: ['Coffee', 'Tea'],
      filters: [
        { yearGte: '2000-01-01', genres: [28, 53, 878, 80] },
        { yearLte: '2010-12-31', genres: [18, 10749, 36, 10402] }
      ]},
    { text: 'Window or Aisle?', options: ['Window', 'Aisle'],
      filters: [
        { genres: [12, 14, 16] },
        { genres: [18, 9648] }
      ]},
    { text: 'Matching or Chaos?', options: ['Matching', 'Chaos'],
      filters: [
        { voteAvg: 7.5 },
        { genres: [878, 27, 9648], voteAvg: 6.5 }
      ]},
    { text: 'Sunrise or Sunset?', options: ['Sunrise', 'Sunset'],
      filters: [
        { genres: [12, 28, 16], yearGte: '2010-01-01' },
        { genres: [18, 10749, 80], yearLte: '2015-12-31' }
      ]},
    { text: 'Cat or Dog?', options: ['Cat', 'Dog'],
      filters: [
        { genres: [9648, 14, 878] },
        { genres: [12, 28, 35] }
      ]},
    { text: 'Rain or Snow?', options: ['Rain', 'Snow'],
      filters: [
        { genres: [18, 53, 80] },
        { genres: [14, 10751, 16] }
      ]},
    { text: 'Book or Movie first?', options: ['Book', 'Movie'],
      filters: [
        { voteAvg: 7.0, genres: [18, 36] },
        { genres: [28, 878, 12], yearGte: '2005-01-01' }
      ]},
    { text: 'City or Countryside?', options: ['City', 'Countryside'],
      filters: [
        { genres: [80, 53, 28], yearGte: '2000-01-01' },
        { genres: [18, 10749, 37] }
      ]},
    { text: 'Sweet or Salty?', options: ['Sweet', 'Salty'],
      filters: [
        { genres: [10749, 35, 10751] },
        { genres: [28, 80, 53] }
      ]},
    { text: 'Night owl or Early bird?', options: ['Night owl', 'Early bird'],
      filters: [
        { genres: [27, 9648, 53] },
        { genres: [12, 35, 10751], yearGte: '2000-01-01' }
      ]},
    { text: 'Minimalist or Maximalist?', options: ['Minimalist', 'Maximalist'],
      filters: [
        { voteAvg: 7.5, genres: [18, 9648] },
        { genres: [14, 28, 878, 12] }
      ]},
    { text: 'Routine or Spontaneity?', options: ['Routine', 'Spontaneity'],
      filters: [
        { voteAvg: 7.0, genres: [18, 36, 10752] },
        { genres: [35, 12, 14], voteAvg: 6.0 }
      ]},
    { text: 'Indie or Blockbuster?', options: ['Indie', 'Blockbuster'],
      filters: [
        { voteAvg: 7.2, genres: [18, 99] },
        { genres: [28, 12, 878], yearGte: '2008-01-01' }
      ]},
    { text: 'Road trip or Staycation?', options: ['Road trip', 'Staycation'],
      filters: [
        { genres: [12, 35] },
        { genres: [18, 9648] }
      ]},
    { text: 'Analog or Digital?', options: ['Analog', 'Digital'],
      filters: [
        { genres: [18, 36], yearLte: '2012-12-31' },
        { genres: [878, 53], yearGte: '2012-01-01' }
      ]},
    { text: 'Mountains or Ocean?', options: ['Mountains', 'Ocean'],
      filters: [
        { genres: [12, 18], yearGte: '1995-01-01' },
        { genres: [12, 53, 14], yearGte: '1995-01-01' }
      ]},
    { text: 'Stargazing or City lights?', options: ['Stargazing', 'City lights'],
      filters: [
        { genres: [878, 12] },
        { genres: [80, 9648, 18] }
      ]},
    { text: 'Solo hero or Ensemble?', options: ['Solo hero', 'Ensemble'],
      filters: [
        { genres: [28, 12] },
        { genres: [35, 18, 80] }
      ]},
    { text: 'Quiet or Loud?', options: ['Quiet', 'Loud'],
      filters: [
        { genres: [18, 9648], voteAvg: 7.3 },
        { genres: [28, 53, 12], voteAvg: 6.5 }
      ]},
    { text: 'Hopeful or Dark?', options: ['Hopeful', 'Dark'],
      filters: [
        { genres: [18, 10751], voteAvg: 7.0 },
        { genres: [53, 27, 9648] }
      ]},
    { text: 'Classic or Experimental?', options: ['Classic', 'Experimental'],
      filters: [
        { genres: [18, 36], voteAvg: 7.2 },
        { genres: [878, 53, 14], voteAvg: 6.6 }
      ]},
    { text: 'Fast or Slow burn?', options: ['Fast', 'Slow burn'],
      filters: [
        { genres: [28, 53, 80] },
        { genres: [18, 9648], voteAvg: 7.3 }
      ]},
    { text: 'Revenge or Redemption?', options: ['Revenge', 'Redemption'],
      filters: [
        { genres: [80, 53, 28] },
        { genres: [18, 36], voteAvg: 7.2 }
      ]},
    { text: 'Dream or Reality?', options: ['Dream', 'Reality'],
      filters: [
        { genres: [14, 878, 9648] },
        { genres: [18, 36] }
      ]},
    { text: 'Party or Cozy night?', options: ['Party', 'Cozy night'],
      filters: [
        { genres: [35, 10402] },
        { genres: [10749, 18] }
      ]},
    { text: 'Space or Sea?', options: ['Space', 'Sea'],
      filters: [
        { genres: [878, 12] },
        { genres: [12, 53] }
      ]},
    { text: 'Myth or Truth?', options: ['Myth', 'Truth'],
      filters: [
        { genres: [14, 12] },
        { genres: [36, 18] }
      ]},
    { text: 'Heist or Chase?', options: ['Heist', 'Chase'],
      filters: [
        { genres: [80, 53] },
        { genres: [28, 53] }
      ]},
    { text: 'Wit or Heart?', options: ['Wit', 'Heart'],
      filters: [
        { genres: [35, 18] },
        { genres: [10749, 18] }
      ]},
    { text: 'Underdog or Legend?', options: ['Underdog', 'Legend'],
      filters: [
        { genres: [18, 35] },
        { genres: [36, 18], voteAvg: 7.1 }
      ]},
    { text: 'Neon or Natural?', options: ['Neon', 'Natural'],
      filters: [
        { genres: [878, 80, 53] },
        { genres: [18, 10751] }
      ]},
    { text: 'Edge or Comfort?', options: ['Edge', 'Comfort'],
      filters: [
        { genres: [53, 27, 9648] },
        { genres: [35, 10751] }
      ]},
    { text: 'Plot twists or Slow reveal?', options: ['Plot twists', 'Slow reveal'],
      filters: [
        { genres: [9648, 53] },
        { genres: [18, 9648], voteAvg: 7.2 }
      ]},
    { text: 'Retro or Futuristic?', options: ['Retro', 'Futuristic'],
      filters: [
        { genres: [35, 80], yearLte: '2010-12-31' },
        { genres: [878, 28], yearGte: '2010-01-01' }
      ]},
    { text: 'Uplifting or Intense?', options: ['Uplifting', 'Intense'],
      filters: [
        { genres: [10751, 35], voteAvg: 6.8 },
        { genres: [53, 80, 28], voteAvg: 6.8 }
      ]},
    { text: 'Grounded or Surreal?', options: ['Grounded', 'Surreal'],
      filters: [
        { genres: [18, 36] },
        { genres: [14, 878, 9648] }
      ]},
    { text: 'Black coffee or Milk tea?', options: ['Black coffee', 'Milk tea'],
      filters: [
        { genres: [80, 53], voteAvg: 7.0 },
        { genres: [35, 10749], voteAvg: 6.8 }
      ]},
    { text: 'Storm or Calm?', options: ['Storm', 'Calm'],
      filters: [
        { genres: [53, 28, 12] },
        { genres: [18, 10749], voteAvg: 7.0 }
      ]},
    { text: 'Comedy or Tension?', options: ['Comedy', 'Tension'],
      filters: [
        { genres: [35, 10751] },
        { genres: [53, 9648] }
      ]},
    { text: 'Dream job or Escape?', options: ['Dream job', 'Escape'],
      filters: [
        { genres: [18, 35] },
        { genres: [12, 53] }
      ]},
    { text: 'Hand-drawn or CGI?', options: ['Hand-drawn', 'CGI'],
      filters: [
        { genres: [16, 10751], yearLte: '2012-12-31' },
        { genres: [16, 14], yearGte: '2012-01-01' }
      ]},
    { text: 'Morning light or Midnight?', options: ['Morning light', 'Midnight'],
      filters: [
        { genres: [10749, 18] },
        { genres: [27, 53, 9648] }
      ]},
    { text: 'Minimal dialogue or Talky?', options: ['Minimal', 'Talky'],
      filters: [
        { genres: [12, 53], voteAvg: 7.0 },
        { genres: [18, 35], voteAvg: 7.0 }
      ]},
    { text: 'Classic hero or Antihero?', options: ['Classic hero', 'Antihero'],
      filters: [
        { genres: [12, 28], voteAvg: 6.8 },
        { genres: [80, 53], voteAvg: 6.8 }
      ]},
    { text: 'Vinyl or Streaming?', options: ['Vinyl', 'Streaming'],
      filters: [
        { genres: [18, 10402], yearLte: '2005-12-31' },
        { genres: [35, 878], yearGte: '2015-01-01' }
      ]},
    { text: 'Rooftop or Basement?', options: ['Rooftop', 'Basement'],
      filters: [
        { genres: [10749, 12] },
        { genres: [27, 9648, 53] }
      ]},
    { text: 'Compass or Map?', options: ['Compass', 'Map'],
      filters: [
        { genres: [12, 14] },
        { genres: [53, 80], voteAvg: 7.0 }
      ]},
    { text: 'First chapter or Last page?', options: ['First chapter', 'Last page'],
      filters: [
        { genres: [12, 14, 878] },
        { genres: [18, 36], voteAvg: 7.2 }
      ]},
    { text: 'Candlelight or Neon?', options: ['Candlelight', 'Neon'],
      filters: [
        { genres: [10749, 18, 36] },
        { genres: [878, 80, 28] }
      ]},
    { text: 'Pen or Sword?', options: ['Pen', 'Sword'],
      filters: [
        { genres: [18, 9648], voteAvg: 7.0 },
        { genres: [28, 12, 14] }
      ]},
    { text: 'Puzzle or Instinct?', options: ['Puzzle', 'Instinct'],
      filters: [
        { genres: [9648, 878] },
        { genres: [28, 12, 53] }
      ]},
    { text: 'Mask or Mirror?', options: ['Mask', 'Mirror'],
      filters: [
        { genres: [9648, 53, 80] },
        { genres: [18, 10749] }
      ]},
    { text: 'Library or Arena?', options: ['Library', 'Arena'],
      filters: [
        { genres: [9648, 18, 36] },
        { genres: [28, 12] }
      ]},
    { text: 'Old film or Fresh release?', options: ['Old film', 'Fresh release'],
      filters: [
        { genres: [18, 36], yearLte: '2005-12-31' },
        { genres: [28, 878, 35], yearGte: '2020-01-01' }
      ]},
    { text: 'Fireplace or Bonfire?', options: ['Fireplace', 'Bonfire'],
      filters: [
        { genres: [10749, 18] },
        { genres: [12, 28, 35] }
      ]},
    { text: 'Whisper or Shout?', options: ['Whisper', 'Shout'],
      filters: [
        { genres: [9648, 18], voteAvg: 7.0 },
        { genres: [28, 35, 10402] }
      ]},
    { text: 'Labyrinth or Highway?', options: ['Labyrinth', 'Highway'],
      filters: [
        { genres: [9648, 14, 878] },
        { genres: [12, 28, 35] }
      ]},
    { text: 'Piano or Drums?', options: ['Piano', 'Drums'],
      filters: [
        { genres: [18, 10749, 10402] },
        { genres: [28, 53, 80] }
      ]},
    { text: 'Ghost or Robot?', options: ['Ghost', 'Robot'],
      filters: [
        { genres: [27, 14, 9648] },
        { genres: [878, 28] }
      ]},
    { text: 'Silk or Leather?', options: ['Silk', 'Leather'],
      filters: [
        { genres: [10749, 18] },
        { genres: [80, 28, 53] }
      ]},
    { text: 'Telescope or Microscope?', options: ['Telescope', 'Microscope'],
      filters: [
        { genres: [878, 12] },
        { genres: [9648, 53, 80] }
      ]},
];
