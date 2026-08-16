import { describe, expect, it } from 'vitest';
import {
  fetchInstructorGradeArchiveForSubjects,
  fetchInstructorGradeArchiveForSubject,
  parseInstructorGradeArchiveHtml,
} from './instructorGradeArchive';

function requestUrlText(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestBodyText(body: RequestInit['body']): string {
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof body === 'string') return body;
  throw new Error('Expected form-encoded request body');
}

const cseFixture = `
<table id="datatable-responsive">
  <thead>
    <tr>
      <th>Subject</th>
      <th>Course</th>
      <th>Year</th>
      <th>Quarter</th>
      <th>Title</th>
      <th>Instructor</th>
      <th>GPA</th>
      <th>A</th>
      <th>B</th>
      <th>C</th>
      <th>D</th>
      <th>F</th>
      <th>W</th>
      <th>P</th>
      <th>NP</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td> CSE </td>
      <td> 101 </td>
      <td> 2025 </td>
      <td> FA </td>
      <td> Design &amp; Analysis of Algorithms </td>
      <td> Hopper, Grace </td>
      <td> 3.42 </td>
      <td> 48.1% </td>
      <td> 32.2% </td>
      <td> 12.3% </td>
      <td> 2.4% </td>
      <td> 1.0% </td>
      <td> 3.0% </td>
      <td> 0.8% </td>
      <td> 0.2% </td>
    </tr>
  </tbody>
</table>
`;

const mathFixture = `
<table id="datatable-responsive">
  <thead>
    <tr>
      <th>Subject</th>
      <th>Course</th>
      <th>Year</th>
      <th>Quarter</th>
      <th>Title</th>
      <th>Instructor</th>
      <th>GPA</th>
      <th>A</th>
      <th>B</th>
      <th>C</th>
      <th>D</th>
      <th>F</th>
      <th>W</th>
      <th>P</th>
      <th>NP</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>MATH</td>
      <td>20A</td>
      <td>2024</td>
      <td>WI</td>
      <td>Calculus for Science and Engineering</td>
      <td>Noether, Emmy</td>
      <td></td>
      <td>44.4</td>
      <td>30.1</td>
      <td>14.2</td>
      <td>3.3</td>
      <td>2.0</td>
      <td>5.0</td>
      <td>1.0</td>
      <td>0.0</td>
    </tr>
    <tr>
      <td>MATH</td>
      <td>20A</td>
      <td>2023</td>
      <td>FA</td>
      <td>Calculus for Science and Engineering</td>
      <td>Hypatia</td>
      <td>withheld</td>
      <td>not posted</td>
      <td>31.0</td>
      <td>13.0</td>
      <td>4.0</td>
      <td>2.0</td>
      <td>6.0</td>
      <td>0.0</td>
      <td>0.0</td>
    </tr>
  </tbody>
</table>
`;

describe('Instructor Grade Archive parser', () => {
  it('parses a UCSD archive table row as a Grade Archive Record', () => {
    const records = parseInstructorGradeArchiveHtml(cseFixture);

    expect(records).toEqual([
      {
        subject: 'CSE',
        course: '101',
        year: '2025',
        quarter: 'FA',
        title: 'Design & Analysis of Algorithms',
        instructor: 'Hopper, Grace',
        gpa: 3.42,
        a: 48.1,
        b: 32.2,
        c: 12.3,
        d: 2.4,
        f: 1,
        w: 3,
        p: 0.8,
        np: 0.2,
        raw: {
          Subject: 'CSE',
          Course: '101',
          Year: '2025',
          Quarter: 'FA',
          Title: 'Design & Analysis of Algorithms',
          Instructor: 'Hopper, Grace',
          GPA: '3.42',
          A: '48.1%',
          B: '32.2%',
          C: '12.3%',
          D: '2.4%',
          F: '1.0%',
          W: '3.0%',
          P: '0.8%',
          NP: '0.2%',
        },
      },
    ]);
  });

  it('keeps MATH rows with missing or malformed GPA values as records', () => {
    const records = parseInstructorGradeArchiveHtml(mathFixture);

    expect(records).toMatchObject([
      {
        subject: 'MATH',
        course: '20A',
        gpa: null,
        a: 44.4,
      },
      {
        subject: 'MATH',
        course: '20A',
        gpa: null,
        a: null,
        raw: {
          GPA: 'withheld',
          A: 'not posted',
        },
      },
    ]);
  });
});

describe('Instructor Grade Archive fetcher', () => {
  it('queries the UCSD archive POST form by Configured Subject', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const records = await fetchInstructorGradeArchiveForSubject('CSE', {
      fetch(url, init) {
        requests.push({ url: requestUrlText(url), init });
        return Promise.resolve(
          new Response(cseFixture, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          }),
        );
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      'https://qa-as.ucsd.edu/Home/InstructorGradeArchive',
    );
    expect(requests[0]!.init).toMatchObject({
      method: 'POST',
    });
    expect(requestBodyText(requests[0]!.init!.body)).toBe(
      'quarter=&year=&instructor=&subject=CSE&courseNumber=',
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      subject: 'CSE',
      course: '101',
    });
  });

  it('queries each Configured Subject and returns the combined archive records', async () => {
    const requestedSubjects: string[] = [];
    const records = await fetchInstructorGradeArchiveForSubjects(
      ['CSE', 'MATH'],
      {
        fetch(_url, init) {
          const body = requestBodyText(init?.body);
          requestedSubjects.push(new URLSearchParams(body).get('subject')!);
          return Promise.resolve(
            new Response(
              body.includes('subject=MATH') ? mathFixture : cseFixture,
              {
                status: 200,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                },
              },
            ),
          );
        },
      },
    );

    expect(requestedSubjects).toEqual(['CSE', 'MATH']);
    expect(records.map((record) => record.subject)).toEqual([
      'CSE',
      'MATH',
      'MATH',
    ]);
  });
});
