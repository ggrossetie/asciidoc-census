-- Repositories with many AsciiDoc files in the GitHub snapshot (bigquery-public-data.github_repos).
-- Only the `files` table is read (paths and blob ids, no file contents): check the estimated
-- bytes processed in the console before running it.
-- Export the result as CSV and pass it to `adoc-census discover`.
--
-- .asc is left out on purpose: in the wild it is mostly PGP keys and signatures.
WITH adoc AS (
  SELECT DISTINCT repo_name, id
  FROM `bigquery-public-data.github_repos.files`
  WHERE REGEXP_CONTAINS(path, r'(?i)\.(adoc|asciidoc|ad)$')
),
repo_size AS (
  SELECT repo_name, COUNT(*) AS files
  FROM adoc
  GROUP BY repo_name
),
-- The dataset has no fork flag. Each blob is owned by the repository that has the most AsciiDoc
-- files among those containing it: forks and vendored copies own few blobs, the original keeps them.
owner AS (
  SELECT a.id, ARRAY_AGG(a.repo_name ORDER BY s.files DESC, a.repo_name LIMIT 1)[OFFSET(0)] AS repo_name
  FROM adoc a
  JOIN repo_size s USING (repo_name)
  GROUP BY a.id
)
SELECT s.repo_name, s.files, COUNT(o.id) AS owned_files
FROM repo_size s
LEFT JOIN owner o USING (repo_name)
GROUP BY s.repo_name, s.files
HAVING owned_files >= 50
ORDER BY owned_files DESC
