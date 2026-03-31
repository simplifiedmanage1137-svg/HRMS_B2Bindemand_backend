// backend/data/holidays.js
// This file should match your frontend src/data/holidays.js exactly

const holidays = [
    // India Holidays 2024
    { date: '2024-01-26', name: 'Republic Day', region: 'India' },
    { date: '2024-03-25', name: 'Holi', region: 'India' },
    { date: '2024-04-11', name: 'Id-ul-Fitr', region: 'India' },
    { date: '2024-04-17', name: 'Ram Navami', region: 'India' },
    { date: '2024-05-01', name: 'Maharashtra Day', region: 'India' },
    { date: '2024-06-17', name: 'Bakri Id', region: 'India' },
    { date: '2024-07-17', name: 'Muharram', region: 'India' },
    { date: '2024-08-15', name: 'Independence Day', region: 'India' },
    { date: '2024-09-07', name: 'Ganesh Chaturthi', region: 'India' },
    { date: '2024-10-02', name: 'Gandhi Jayanti', region: 'India' },
    { date: '2024-10-12', name: 'Dussehra', region: 'India' },
    { date: '2024-10-31', name: 'Diwali', region: 'India' },
    { date: '2024-11-15', name: 'Guru Nanak Jayanti', region: 'India' },
    { date: '2024-12-25', name: 'Christmas', region: 'India' },
    
    // USA Holidays 2024
    { date: '2024-01-01', name: "New Year's Day", region: 'USA' },
    { date: '2024-01-15', name: 'Martin Luther King Jr. Day', region: 'USA' },
    { date: '2024-02-19', name: "Presidents' Day", region: 'USA' },
    { date: '2024-05-27', name: 'Memorial Day', region: 'USA' },
    { date: '2024-06-19', name: 'Juneteenth', region: 'USA' },
    { date: '2024-07-04', name: 'Independence Day', region: 'USA' },
    { date: '2024-09-02', name: 'Labor Day', region: 'USA' },
    { date: '2024-10-14', name: 'Columbus Day', region: 'USA' },
    { date: '2024-11-11', name: 'Veterans Day', region: 'USA' },
    { date: '2024-11-28', name: 'Thanksgiving', region: 'USA' },
    { date: '2024-12-25', name: 'Christmas', region: 'USA' },
    
    // Global Holidays 2024
    { date: '2024-01-01', name: "New Year's Day", region: 'Global' },
    { date: '2024-05-01', name: 'Labour Day', region: 'Global' },
    { date: '2024-12-25', name: 'Christmas', region: 'Global' },
    { date: '2024-12-31', name: "New Year's Eve", region: 'Global' },
    
    // India Holidays 2025
    { date: '2025-01-26', name: 'Republic Day', region: 'India' },
    { date: '2025-03-14', name: 'Holi', region: 'India' },
    { date: '2025-03-31', name: 'Id-ul-Fitr', region: 'India' },
    { date: '2025-04-06', name: 'Ram Navami', region: 'India' },
    { date: '2025-05-01', name: 'Maharashtra Day', region: 'India' },
    { date: '2025-06-07', name: 'Bakri Id', region: 'India' },
    { date: '2025-07-06', name: 'Muharram', region: 'India' },
    { date: '2025-08-15', name: 'Independence Day', region: 'India' },
    { date: '2025-08-27', name: 'Ganesh Chaturthi', region: 'India' },
    { date: '2025-10-02', name: 'Gandhi Jayanti', region: 'India' },
    { date: '2025-10-02', name: 'Dussehra', region: 'India' },
    { date: '2025-10-20', name: 'Diwali', region: 'India' },
    { date: '2025-11-05', name: 'Guru Nanak Jayanti', region: 'India' },
    { date: '2025-12-25', name: 'Christmas', region: 'India' },
    
    // USA Holidays 2025
    { date: '2025-01-01', name: "New Year's Day", region: 'USA' },
    { date: '2025-01-20', name: 'Martin Luther King Jr. Day', region: 'USA' },
    { date: '2025-02-17', name: "Presidents' Day", region: 'USA' },
    { date: '2025-05-26', name: 'Memorial Day', region: 'USA' },
    { date: '2025-06-19', name: 'Juneteenth', region: 'USA' },
    { date: '2025-07-04', name: 'Independence Day', region: 'USA' },
    { date: '2025-09-01', name: 'Labor Day', region: 'USA' },
    { date: '2025-10-13', name: 'Columbus Day', region: 'USA' },
    { date: '2025-11-11', name: 'Veterans Day', region: 'USA' },
    { date: '2025-11-27', name: 'Thanksgiving', region: 'USA' },
    { date: '2025-12-25', name: 'Christmas', region: 'USA' },
    
    // Global Holidays 2025
    { date: '2025-01-01', name: "New Year's Day", region: 'Global' },
    { date: '2025-05-01', name: 'Labour Day', region: 'Global' },
    { date: '2025-12-25', name: 'Christmas', region: 'Global' },
    { date: '2025-12-31', name: "New Year's Eve", region: 'Global' },
    
    // India Holidays 2026
    { date: '2026-01-26', name: 'Republic Day', region: 'India' },
    { date: '2026-03-02', name: 'Holi', region: 'India' },
    { date: '2026-03-20', name: 'Id-ul-Fitr', region: 'India' },
    { date: '2026-03-28', name: 'Ram Navami', region: 'India' },
    { date: '2026-05-01', name: 'Maharashtra Day', region: 'India' },
    { date: '2026-05-27', name: 'Bakri Id', region: 'India' },
    { date: '2026-06-25', name: 'Muharram', region: 'India' },
    { date: '2026-08-15', name: 'Independence Day', region: 'India' },
    { date: '2026-09-17', name: 'Ganesh Chaturthi', region: 'India' },
    { date: '2026-10-02', name: 'Gandhi Jayanti', region: 'India' },
    { date: '2026-10-21', name: 'Dussehra', region: 'India' },
    { date: '2026-11-09', name: 'Diwali', region: 'India' },
    { date: '2026-11-25', name: 'Guru Nanak Jayanti', region: 'India' },
    { date: '2026-12-25', name: 'Christmas', region: 'India' },
    
    // USA Holidays 2026
    { date: '2026-01-01', name: "New Year's Day", region: 'USA' },
    { date: '2026-01-19', name: 'Martin Luther King Jr. Day', region: 'USA' },
    { date: '2026-02-16', name: "Presidents' Day", region: 'USA' },
    { date: '2026-05-25', name: 'Memorial Day', region: 'USA' },
    { date: '2026-06-19', name: 'Juneteenth', region: 'USA' },
    { date: '2026-07-04', name: 'Independence Day', region: 'USA' },
    { date: '2026-09-07', name: 'Labor Day', region: 'USA' },
    { date: '2026-10-12', name: 'Columbus Day', region: 'USA' },
    { date: '2026-11-11', name: 'Veterans Day', region: 'USA' },
    { date: '2026-11-26', name: 'Thanksgiving', region: 'USA' },
    { date: '2026-12-25', name: 'Christmas', region: 'USA' },
    
    // Global Holidays 2026
    { date: '2026-01-01', name: "New Year's Day", region: 'Global' },
    { date: '2026-05-01', name: 'Labour Day', region: 'Global' },
    { date: '2026-12-25', name: 'Christmas', region: 'Global' },
    { date: '2026-12-31', name: "New Year's Eve", region: 'Global' }
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