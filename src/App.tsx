import React, { useState, useRef } from 'react';
import { Settings, Download, AlertCircle, Loader2, BarChart3, Clock, Users, Briefcase, FileSpreadsheet, UploadCloud, X, FileText } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { Worklog } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import * as htmlToImage from 'html-to-image';
import jsPDF from 'jspdf';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [worklogs, setWorklogs] = useState<Worklog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(true);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv') && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setError('Please upload a valid CSV or Excel file.');
      return;
    }
    processFile(file);
  };

  const processFile = (file: File) => {
    setLoading(true);
    setError(null);
    setFileName(file.name);

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: false, // Read as 2D array to handle both standard and matrix formats
        skipEmptyLines: 'greedy',
        complete: (results) => {
          handleParsedData(results.data as string[][]);
        },
        error: (err) => {
          setError(`Failed to parse CSV: ${err.message}`);
          setLoading(false);
        }
      });
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];
          handleParsedData(rows);
        } catch (err: any) {
          setError(`Failed to parse Excel file: ${err.message}`);
          setLoading(false);
        }
      };
      reader.onerror = () => {
        setError('Failed to read file.');
        setLoading(false);
      };
      reader.readAsArrayBuffer(file);
    } else {
      setError('Unsupported file format.');
      setLoading(false);
    }
  };

  const handleParsedData = (rows: string[][]) => {
    try {
      if (rows.length === 0) {
        throw new Error('The file is empty.');
      }

      let newWorklogs: Worklog[] = [];

      // Detect "Timesheet Builder" Matrix format
      if (rows[0] && rows[0][0] === 'Report' && rows[0][1] && String(rows[0][1]).includes('Timesheet')) {
        newWorklogs = parseMatrixFormat(rows);
      } else {
        newWorklogs = parseStandardFormat(rows);
      }

      if (newWorklogs.length === 0) {
        throw new Error('No valid worklog entries found. Make sure the file contains valid time tracking data.');
      }

      setWorklogs(newWorklogs);
      setIsConfigOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const parseMatrixFormat = (rows: string[][]): Worklog[] => {
    const worklogs: Worklog[] = [];
    
    // Extract Author
    const author = rows[0][1].replace(/Timesheet/i, '').trim();
    
    // Extract Month and Year from "Dates range"
    const dateRangeRow = rows.find(r => r[0] === 'Dates range');
    let mm = '01', yyyy = new Date().getFullYear().toString();
    
    if (dateRangeRow && dateRangeRow[1]) {
      const startDateStr = dateRangeRow[1].split('-')[0].trim(); // e.g., "01/02/2026"
      const parts = startDateStr.split(/[-/]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) { 
          yyyy = parts[0]; mm = parts[1]; // YYYY-MM-DD
        } else if (parts[2].length === 4) { 
          yyyy = parts[2]; mm = parts[1]; // DD/MM/YYYY
        }
      }
    }

    // Find the header row
    const headerIdx = rows.findIndex(r => r[0] === 'Issue' && r[1] === 'Key');
    if (headerIdx === -1) {
      throw new Error("Could not find 'Issue' and 'Key' headers in the matrix.");
    }
    
    const headers = rows[headerIdx];

    // Parse data rows
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;
      
      // Stop parsing if we hit the Total row or footer
      if (row[0] === 'Total' || row[0].startsWith('Generated')) break;

      const issueSummary = row[0];
      const issueKey = row[1];
      const projectName = issueKey.split('-')[0] || 'Unknown';

      // Iterate through the daily columns (starting from index 3)
      for (let c = 3; c < row.length; c++) {
        const val = parseFloat(row[c]);
        if (!isNaN(val) && val > 0) {
          const dayMatch = headers[c]?.match(/\d+/);
          if (dayMatch) {
            const day = dayMatch[0].padStart(2, '0');
            const date = `${yyyy}-${mm}-${day}`;
            
            worklogs.push({
              id: `wl-${i}-${c}-${Math.random().toString(36).substr(2, 9)}`,
              issueKey,
              issueSummary,
              projectName,
              author,
              authorEmail: '',
              timeSpentSeconds: val * 3600, // Matrix format is usually in hours
              date,
              comment: ''
            });
          }
        }
      }
    }

    return worklogs;
  };

  const parseStandardFormat = (rows: string[][]): Worklog[] => {
    const headers = rows[0].map(h => (h || '').toLowerCase().trim());
    const parsedData = rows.slice(1).map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

    const findCol = (keywords: string[]) => {
      const exact = headers.find(h => keywords.includes(h));
      if (exact) return exact;
      return headers.find(h => keywords.some(k => h.includes(k)));
    };

    const colIssueKey = findCol(['issue key', 'key', 'issue']);
    const colSummary = findCol(['summary', 'title', 'description']);
    const colProject = findCol(['project name', 'project', 'project key']);
    const colAuthor = findCol(['worklog author', 'author', 'user', 'name', 'assignee', 'employee']);
    const colEmail = findCol(['email', 'author email', 'user email']);
    const colTimeSpent = findCol(['time spent', 'hours', 'time', 'spent', 'duration', 'logged']);
    const colDate = findCol(['worklog date', 'date', 'started', 'created', 'day']);
    const colComment = findCol(['comment', 'worklog comment', 'description', 'notes']);

    if (!colIssueKey && !colAuthor && !colTimeSpent) {
      throw new Error('Could not identify required columns (Issue Key, Author, Time Spent) in the CSV. Please ensure your CSV has clear headers.');
    }

    return parsedData.map((row, index) => {
      let timeSpentSeconds = 0;
      const rawTime = String(row[colTimeSpent || ''] || '0').trim();
      
      if (!isNaN(Number(rawTime)) && rawTime !== '') {
        const num = Number(rawTime);
        timeSpentSeconds = num < 100 ? num * 3600 : num;
      } else {
        const days = rawTime.match(/(\d+(?:\.\d+)?)\s*d/i);
        const hours = rawTime.match(/(\d+(?:\.\d+)?)\s*h/i);
        const mins = rawTime.match(/(\d+(?:\.\d+)?)\s*m/i);
        
        if (days) timeSpentSeconds += parseFloat(days[1]) * 8 * 3600;
        if (hours) timeSpentSeconds += parseFloat(hours[1]) * 3600;
        if (mins) timeSpentSeconds += parseFloat(mins[1]) * 60;
      }

      let parsedDate = '';
      const rawDate = String(row[colDate || ''] || '').trim();
      if (rawDate) {
        const match = rawDate.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})/);
        if (match) {
          parsedDate = match[0].replace(/\//g, '-');
        } else {
          parsedDate = rawDate.substring(0, 10);
        }
      }

      return {
        id: `wl-${index}-${Math.random().toString(36).substr(2, 9)}`,
        issueKey: row[colIssueKey || ''] || 'Unknown',
        issueSummary: row[colSummary || ''] || 'Unknown',
        projectName: row[colProject || ''] || (row[colIssueKey || '']?.split('-')[0]) || 'Unknown',
        author: row[colAuthor || ''] || 'Unknown',
        authorEmail: row[colEmail || ''] || '',
        timeSpentSeconds: timeSpentSeconds,
        date: parsedDate,
        comment: row[colComment || ''] || ''
      };
    }).filter(wl => wl.timeSpentSeconds > 0);
  };

  const clearData = () => {
    setWorklogs([]);
    setFileName(null);
    setError(null);
    setIsConfigOpen(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const exportToCsv = () => {
    if (worklogs.length === 0) return;

    const headers = ['Date', 'Project', 'Issue Key', 'Issue Summary', 'Author', 'Email', 'Hours', 'Comment'];
    const csvContent = [
      headers.join(','),
      ...worklogs.map(wl => [
        wl.date,
        `"${wl.projectName}"`,
        wl.issueKey,
        `"${wl.issueSummary.replace(/"/g, '""')}"`,
        `"${wl.author}"`,
        wl.authorEmail,
        (wl.timeSpentSeconds / 3600).toFixed(2),
        `"${(wl.comment || '').replace(/"/g, '""')}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `jira_worklogs_export.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToExcel = () => {
    if (worklogs.length === 0) return;

    const data = worklogs.map(wl => ({
      'Date': wl.date,
      'Project': wl.projectName,
      'Issue Key': wl.issueKey,
      'Issue Summary': wl.issueSummary,
      'Author': wl.author,
      'Email': wl.authorEmail,
      'Hours': Number((wl.timeSpentSeconds / 3600).toFixed(2)),
      'Comment': wl.comment || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Worklogs");
    XLSX.writeFile(wb, "jira_worklogs_export.xlsx");
  };

  const exportToPdf = async () => {
    if (!dashboardRef.current || worklogs.length === 0) return;
    
    try {
      setIsExportingPdf(true);
      
      // Small delay to ensure any UI updates are rendered
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const imgData = await htmlToImage.toPng(dashboardRef.current, {
        pixelRatio: 2,
        backgroundColor: '#f8fafc' // slate-50
      });
      
      // A4 dimensions in mm
      const pdfWidth = 210;
      const pdfHeight = 297;
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      // Calculate image dimensions to fit page width
      const imgProps = pdf.getImageProperties(imgData);
      const imgWidth = pdfWidth;
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
      
      let heightLeft = imgHeight;
      let position = 0;
      
      // Add first page
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
      
      // Add subsequent pages if the content is taller than one page
      while (heightLeft > 0) {
        position -= pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      
      pdf.save('jira_worklogs_dashboard.pdf');
    } catch (err) {
      console.error('Error generating PDF:', err);
      setError('Failed to generate PDF. Please try again.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Derived data for charts
  const totalHours = worklogs.reduce((sum, wl) => sum + wl.timeSpentSeconds, 0) / 3600;
  const uniqueUsers = new Set(worklogs.map(wl => wl.author)).size;
  const uniqueProjects = new Set(worklogs.map(wl => wl.projectName)).size;

  const hoursByUser = worklogs.reduce((acc, wl) => {
    const hours = wl.timeSpentSeconds / 3600;
    acc[wl.author] = (acc[wl.author] || 0) + hours;
    return acc;
  }, {} as Record<string, number>);

  const userChartData = Object.entries(hoursByUser)
    .map(([name, hours]) => ({ name, hours: Number((hours as number).toFixed(2)) }))
    .sort((a, b) => b.hours - a.hours);

  const hoursByProject = worklogs.reduce((acc, wl) => {
    const hours = wl.timeSpentSeconds / 3600;
    acc[wl.projectName] = (acc[wl.projectName] || 0) + hours;
    return acc;
  }, {} as Record<string, number>);

  const projectChartData = Object.entries(hoursByProject)
    .map(([name, hours]) => ({ name, hours: Number((hours as number).toFixed(2)) }))
    .sort((a, b) => b.hours - a.hours);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900">
      {/* Sidebar Configuration */}
      <aside className={cn(
        "bg-white border-r border-slate-200 w-full md:w-80 flex-shrink-0 transition-all duration-300 overflow-y-auto",
        isConfigOpen ? "block" : "hidden md:block md:w-16"
      )}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className={cn("flex items-center gap-2 font-semibold", !isConfigOpen && "md:hidden")}>
            <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
            <span>Data Source</span>
          </div>
          <button 
            onClick={() => setIsConfigOpen(!isConfigOpen)}
            className="p-1.5 hover:bg-slate-100 rounded-md text-slate-500 hidden md:block"
            title={isConfigOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        <div className={cn("p-6", !isConfigOpen && "md:hidden")}>
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Upload File</h3>
              <p className="text-xs text-slate-500 mb-4">
                Upload a Jira worklog export or any CSV/Excel containing time tracking data.
              </p>
              
              <div 
                className={cn(
                  "border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center transition-colors cursor-pointer",
                  fileName ? "border-indigo-300 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  accept=".csv,.xlsx,.xls" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                
                {fileName ? (
                  <>
                    <FileSpreadsheet className="w-10 h-10 text-indigo-500 mb-3" />
                    <p className="text-sm font-medium text-indigo-900 break-all">{fileName}</p>
                    <p className="text-xs text-indigo-600 mt-1">Click or drag to replace</p>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-10 h-10 text-slate-400 mb-3" />
                    <p className="text-sm font-medium text-slate-700">Click to upload or drag and drop</p>
                    <p className="text-xs text-slate-500 mt-1">CSV or Excel files</p>
                  </>
                )}
              </div>
            </div>

            {worklogs.length > 0 && (
              <div className="pt-4 border-t border-slate-200">
                <button
                  onClick={clearData}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Clear Data
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Worklog Dashboard</h1>
            <p className="text-sm text-slate-500">Analyze time tracking data from CSV</p>
          </div>
          
          {worklogs.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={exportToCsv}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                disabled={isExportingPdf}
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
              <button
                onClick={exportToExcel}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-md text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                disabled={isExportingPdf}
              >
                <FileSpreadsheet className="w-4 h-4" />
                Excel
              </button>
              <button
                onClick={exportToPdf}
                className="flex items-center gap-2 px-4 py-2 bg-rose-50 border border-rose-200 rounded-md text-sm font-medium text-rose-700 hover:bg-rose-100 transition-colors"
                disabled={isExportingPdf}
              >
                {isExportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                {isExportingPdf ? 'Exporting...' : 'PDF'}
              </button>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 text-red-800">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold">Error parsing data</h4>
                <p className="text-sm mt-1">{error}</p>
              </div>
            </div>
          )}

          {!loading && worklogs.length === 0 && !error && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 p-6">
              <BarChart3 className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg font-medium text-slate-600">No data to display</p>
              <p className="text-sm mt-1">Upload a CSV or Excel file from the sidebar to generate the dashboard.</p>
            </div>
          )}

          {loading && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 p-6">
              <Loader2 className="w-12 h-12 mb-4 animate-spin text-indigo-500" />
              <p className="text-lg font-medium text-slate-600">Processing file...</p>
              <p className="text-sm mt-1">Mapping columns and generating insights.</p>
            </div>
          )}

          {worklogs.length > 0 && !loading && (
            <div className="space-y-6 max-w-7xl mx-auto p-6 bg-slate-50" ref={dashboardRef}>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <div className="flex items-center gap-3 text-slate-500 mb-2">
                    <Clock className="w-5 h-5 text-indigo-500" />
                    <h3 className="font-medium">Total Hours</h3>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{totalHours.toFixed(1)}<span className="text-lg text-slate-500 font-normal ml-1">hrs</span></p>
                </div>
                
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <div className="flex items-center gap-3 text-slate-500 mb-2">
                    <Users className="w-5 h-5 text-emerald-500" />
                    <h3 className="font-medium">Active Users</h3>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{uniqueUsers}</p>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <div className="flex items-center gap-3 text-slate-500 mb-2">
                    <Briefcase className="w-5 h-5 text-amber-500" />
                    <h3 className="font-medium">Projects</h3>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{uniqueProjects}</p>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <h3 className="font-semibold text-slate-800 mb-6">Hours by User</h3>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={userChartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis type="number" />
                        <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                        <RechartsTooltip 
                          cursor={{ fill: '#f1f5f9' }}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="hours" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={24} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <h3 className="font-semibold text-slate-800 mb-6">Hours by Project</h3>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={projectChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis />
                        <RechartsTooltip 
                          cursor={{ fill: '#f1f5f9' }}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="hours" fill="#10b981" radius={[4, 4, 0, 0]} barSize={40} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Detailed Table */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="p-5 border-b border-slate-200">
                  <h3 className="font-semibold text-slate-800">Detailed Worklogs</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left text-slate-600">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3 font-medium">Date</th>
                        <th className="px-6 py-3 font-medium">User</th>
                        <th className="px-6 py-3 font-medium">Project</th>
                        <th className="px-6 py-3 font-medium">Issue</th>
                        <th className="px-6 py-3 font-medium text-right">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {worklogs.slice(0, 100).map((wl, i) => (
                        <tr key={`${wl.id}-${i}`} className="border-b border-slate-100 hover:bg-slate-50 last:border-0">
                          <td className="px-6 py-3 whitespace-nowrap font-mono text-xs">{wl.date}</td>
                          <td className="px-6 py-3 font-medium text-slate-900">{wl.author}</td>
                          <td className="px-6 py-3">{wl.projectName}</td>
                          <td className="px-6 py-3">
                            <div className="flex flex-col">
                              <span className="font-medium text-indigo-600">{wl.issueKey}</span>
                              <span className="text-xs text-slate-500 truncate max-w-[300px]" title={wl.issueSummary}>
                                {wl.issueSummary}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right font-mono font-medium">
                            {(wl.timeSpentSeconds / 3600).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {worklogs.length > 100 && (
                    <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 border-t border-slate-200">
                      Showing first 100 entries. Export to CSV to see all {worklogs.length} records.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
