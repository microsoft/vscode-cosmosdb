export function buildHtmlReport({
    assessmentDetails,
    instanceSummary,
    combinedAssessmentReportData,
}: {
    assessmentDetails: any;
    instanceSummary: any;
    combinedAssessmentReportData: any;
}): string {
    const escape = (str: any) =>
        str
            ?.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;') ?? 'NA';

    const renderAssessmentRow = (row: any) => `
    <tr>
      <td>${escape(row.DatabaseName)}</td>
      <td>${escape(row.CollectionName)}</td>
      <td>${escape(row.AssessmentCategory)}</td>
      <td>${escape(row.AssessmentSeverity)}</td>
      <td>${escape(row.Message)}</td>
    </tr>`;

    const renderDatabaseRow = (db: any) => {
        const sizeGb = (db.DataSize / Math.pow(1024, 3)).toFixed(3);
        return `
      <tr>
        <td>${escape(db.DatabaseName)}</td>
        <td>${escape(db.CollectionCount)}</td>
        <td>${escape(db.ViewCount)}</td>
        <td>${escape(db.TimeSeriesCount)}</td>
        <td>${escape(sizeGb)}</td>
      </tr>`;
    };

    const renderCollectionRow = (col: any) => {
        const dataGb = (col.DataSize / Math.pow(1024, 3)).toFixed(3);
        const indexGb = (col.IndexSize / Math.pow(1024, 3)).toFixed(3);
        return `
      <tr>
        <td>${escape(col.DatabaseName)}</td>
        <td>${escape(col.CollectionName)}</td>
        <td>${escape(col.Type)}</td>
        <td>${escape(col.IsSharded)}</td>
        <td>${escape(col.ShardKey ?? '–')}</td>
        <td>${escape(col.DocumentCount)}</td>
        <td>${escape(col.IndexCount)}</td>
        <td>${escape(dataGb)}</td>
        <td>${escape(indexGb)}</td>
        <td>${escape(col.AverageDocumentSize)}</td>
      </tr>`;
    };

    const assessmentRows = (combinedAssessmentReportData.Assessments ?? []).map(renderAssessmentRow).join('');

    const databaseRows = (instanceSummary.DatabaseSummary ?? []).map(renderDatabaseRow).join('');

    const collectionRows = (instanceSummary.CollectionSummary ?? []).map(renderCollectionRow).join('');

    const logFolder = assessmentDetails.LogFolderPath;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Assessment Report</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: sans-serif; padding: 20px; background: #f9f9f9; color: #333; }
    h1, h2 { border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #eee; }
    .section { margin-top: 20px; }
  </style>
</head>
<body>
  <h1>Assessment Report</h1>

  <div class="section">
    <h2>General Information</h2>
    <p><b> Migration Name:</b> ${escape(assessmentDetails.AssessmentName)}</p>
    <p><b>Assessment ID:</b> ${escape(assessmentDetails.AssessmentId)}</p>
    <p><b>Assessment Start Time:</b> ${escape(assessmentDetails.StartTime)}</p>
    <p><b>Assessment End Time:</b> ${escape(assessmentDetails.EndTime)}</p>
     <p><b>Mongo DB Log Folder Path:</b> ${logFolder?.length ? escape(logFolder) : '<span style="font-style: italic;">NA</span>'}</p>

  </div>

    <div class="section">
    <h2>Instance Summary</h2>
         <p><b>Source Version:</b> ${escape(instanceSummary.SourceVersion)}</p>
    <p><b>License Type:</b> ${escape(instanceSummary.LicenseType)}</p>
     <p><b>Source Instance Type:</b> ${escape(instanceSummary.InstanceType)}</p>

  </div>

  <div class="section">
    <h2>Database Summary</h2>

    <p><b>Total Database Count:</b> ${escape(instanceSummary.TotalDatabaseCount)}</p>
    <p><b>Total Collection Count:</b> ${escape(instanceSummary.TotalCollectionCount)}</p>
    <p><b>Total Views Count:</b> ${escape(instanceSummary.TotalViewsCount)}</p>
    <p><b>Total Timeseries Count:</b> ${escape(instanceSummary.TotalTimeseriesCount)}</p>
  </div>

  <div class="section">
    <table>
      <thead>
        <tr>
          <th>Database</th><th>Collections</th><th>Views</th><th>TimeSeries</th><th>Data (GB)</th>
        </tr>
      </thead>
      <tbody>${databaseRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Collection Summary</h2>
      <p><b>Number of Collections:</b> ${escape(
          Number(instanceSummary.TotalCollectionCount) +
              Number(instanceSummary.TotalTimeseriesCount) +
              Number(instanceSummary.TotalViewsCount),
      )}</p>

       <p><b>Total Index Count:</b> ${escape(instanceSummary.TotalIndexesCount)}</p>

    <table>
      <thead>
        <tr>
          <th>Database</th><th>Collection</th><th>Type</th><th>Sharded</th><th>Shard Key</th>
          <th>Docs</th><th>Indexes</th><th>Data (GB)</th><th>Index (GB)</th><th>Avg Doc Size</th>
        </tr>
      </thead>
      <tbody>${collectionRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Assessment Summary</h2>
    <table>
      <thead>
        <tr>
          <th>Database</th><th>Collection</th><th>Category</th><th>Severity</th><th>Message</th>
        </tr>
      </thead>
      <tbody>${assessmentRows}</tbody>
    </table>
  </div>
</body>
</html>`;
}
