// backend/data/holidays.js
// Synced with frontend/src/data/holidays.js

const holidays = [
  // January 2026
  { date: '2026-01-01', name: "New Year's Day", region: 'USA', type: 'public_holiday' },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day', region: 'USA', type: 'public_holiday' },
  { date: '2026-01-26', name: 'Republic Day', region: 'India', type: 'public_holiday' },

  // February 2026
  { date: '2026-02-16', name: "Presidents' Day", region: 'USA', type: 'public_holiday' },

  // March 2026
  { date: '2026-03-04', name: 'Holi', region: 'India', type: 'public_holiday' },
  { date: '2026-03-20', name: 'Eid-Ul-Fitr', region: 'India', type: 'public_holiday' },

  // April 2026
  { date: '2026-04-03', name: 'Good Friday', region: 'USA & India', type: 'public_holiday' },

  // May 2026
  { date: '2026-05-25', name: 'Memorial Day', region: 'USA', type: 'public_holiday' },

  // June 2026
  { date: '2026-06-19', name: 'Juneteenth', region: 'USA', type: 'public_holiday' },

  // July 2026
  { date: '2026-07-03', name: 'US Independence Day', region: 'USA', type: 'public_holiday' },

  // August 2026
  { date: '2026-08-15', name: 'India Independence Day', region: 'India', type: 'public_holiday' },

  // September 2026
  { date: '2026-09-07', name: 'Labor Day', region: 'USA', type: 'public_holiday' },
  { date: '2026-09-14', name: 'Ganesh Chaturthi', region: 'India', type: 'public_holiday' },

  // October 2026
  { date: '2026-10-02', name: 'Gandhi Jayanti', region: 'India', type: 'optional_holiday' },
  { date: '2026-10-12', name: 'Columbus Day', region: 'USA', type: 'public_holiday' },

  // November 2026
  { date: '2026-11-08', name: 'Diwali', region: 'India', type: 'public_holiday' },
  { date: '2026-11-26', name: 'Thanksgiving', region: 'USA', type: 'public_holiday' },

  // December 2026
  { date: '2026-12-25', name: 'Christmas Day', region: 'USA & India', type: 'public_holiday' },
];

// Helper functions
const getHolidaysByRegion = (region) => {
    if (region === 'All') return holidays;
    return holidays.filter(h => h.region === region);
};

const getHolidaysByYear = (year) => {
    return holidays.filter(h => new Date(h.date).getFullYear() === year);
};

const isDateHoliday = (dateStr) => {
    return holidays.some(h => h.date === dateStr);
};

const getHolidayName = (dateStr) => {
    const holiday = holidays.find(h => h.date === dateStr);
    return holiday ? holiday.name : null;
};

module.exports = {
    holidays,
    getHolidaysByRegion,
    getHolidaysByYear,
    isDateHoliday,
    getHolidayName
};