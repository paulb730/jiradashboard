export interface Worklog {
  id: string;
  issueKey: string;
  issueSummary: string;
  projectName: string;
  author: string;
  authorEmail: string;
  timeSpentSeconds: number;
  date: string;
  comment: string;
}

export interface JiraParams {
  jiraUrl: string;
  projects: string;
  users: string;
  startDate: string;
  endDate: string;
}
