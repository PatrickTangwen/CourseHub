import { describe, expect, it } from 'vitest';
import {
  validateCatalogSnapshot,
  type CatalogSnapshotConfig,
} from './catalogSnapshot';
import {
  buildScheduleCatalogSnapshot,
  fetchScheduleOfClassesForSubjects,
  parseScheduleOfClassesHtml,
} from './scheduleOfClasses';

const sourceUrl =
  'https://act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudentResult.htm';
const fetchedAt = '2026-06-19T12:00:00.000Z';

function requestUrlText(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function makeConfig(): CatalogSnapshotConfig {
  return {
    active_planning_term: 'SP26',
    term_label: 'Spring 2026',
    term_date_range: {
      start: '2026-03-30',
      end: '2026-06-12',
    },
    configured_subjects: ['CSE', 'MATH'],
    paths: {
      raw_dir: 'data/raw',
      normalized_dir: 'data/normalized',
      reports_dir: 'data/reports',
      public_catalog_dir: 'api/static/catalogs/public',
      metadata_path: 'api/static/metadata.json',
    },
  };
}

const cseFixture = `
<table id="socDeptTab">
  <tr>
    <td colspan="13">
      <h2><span class="centeralign">Computer Science &amp; Engineering (CSE  )</span></h2>
      <span class="centeralign"><span class="bold_text">As of: 04/01/2026, 05:27:00</span></span>
    </td>
  </tr>
  <tr>
    <td class="ubrdr">R</td>
    <td class="ubrdr">Course Number</td>
    <td class="ubrdr">Section ID</td>
    <td class="ubrdr">Meeting Type</td>
    <td class="ubrdr">Section</td>
    <td class="ubrdr">Days</td>
    <td class="ubrdr">Time</td>
    <td class="ubrdr" colspan="2">Building &amp; Room</td>
    <td class="ubrdr">Instructor</td>
    <td class="ubrdr">Available</td>
    <td class="ubrdr">Limit</td>
    <td class="ubrdr">&nbsp;</td>
  </tr>
  <tr>
    <td class="crsheader"></td>
    <td class="crsheader">5</td>
    <td class="crsheader" colspan="5">
      <a href="javascript:openNewWindow('http://www.ucsd.edu/catalog/courses/CSE.html#cse5')">
        <span class="boldtxt">Intro to Programming</span>
      </a>
      ( 4 Units)
    </td>
    <td class="crsheader" colspan="6" align="right">Prerequisites | Evaluations</td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"><span id="insTyp" title="Lecture">LE</span></td>
    <td class="brdr">A00</td>
    <td class="brdr">TuTh</td>
    <td class="brdr">3:30p-4:50p</td>
    <td class="brdr"><a href="https://maps.ucsd.edu/?id=1005#!s/CENTR_Main">CENTR</a></td>
    <td class="brdr">109</td>
    <td class="brdr"><a href="#!">Bonjour, Trevor</a><br></td>
    <td class="brdr"><span class="ertext">&nbsp;</span></td>
    <td class="brdr"><span class="ertext">&nbsp;</span></td>
    <td class="brdr"><span class="ertext">&nbsp;</span></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">252174</td>
    <td class="brdr"><span id="insTyp" title="Discussion">DI</span></td>
    <td class="brdr">A01</td>
    <td class="brdr">M</td>
    <td class="brdr">4:00p-4:50p</td>
    <td class="brdr"><a href="https://maps.ucsd.edu/?id=1005#!s/CENTR_Main">CENTR</a></td>
    <td class="brdr">212</td>
    <td class="brdr"><a href="#!">Bonjour, Trevor</a><br></td>
    <td class="brdr">FULL<br>Waitlist(1)</td>
    <td class="brdr">146</td>
    <td class="brdr">bookstore</td>
  </tr>
</table>
`;

const cseSecondPageFixture = `
<div>Page  (2&nbsp;of&nbsp;2)</div>
<table id="socDeptTab">
  <tr>
    <td colspan="13">
      <h2><span class="centeralign">Computer Science &amp; Engineering (CSE  )</span></h2>
      <span class="centeralign"><span class="bold_text">As of: 04/01/2026, 05:27:00</span></span>
    </td>
  </tr>
  <tr>
    <td class="crsheader"></td>
    <td class="crsheader">30</td>
    <td class="crsheader" colspan="5">
      <a href="javascript:openNewWindow('http://www.ucsd.edu/catalog/courses/CSE.html#cse30')">
        <span class="boldtxt">Computer Organization</span>
      </a>
      ( 4 Units)
    </td>
    <td class="crsheader" colspan="6" align="right">Prerequisites | Evaluations</td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">300001</td>
    <td class="brdr"><span id="insTyp" title="Lecture">LE</span></td>
    <td class="brdr">A01</td>
    <td class="brdr">TuTh</td>
    <td class="brdr">9:30a-10:50a</td>
    <td class="brdr">WLH</td>
    <td class="brdr">2001</td>
    <td class="brdr"><a href="#!">Chin, Bryan W.</a><br></td>
    <td class="brdr">5</td>
    <td class="brdr">100</td>
    <td class="brdr">bookstore</td>
  </tr>
</table>
`;

const mathFixture = `
<table id="socDeptTab">
  <tr>
    <td colspan="13">
      <h2><span class="centeralign">Mathematics (MATH )</span></h2>
      <span class="centeralign"><span class="bold_text">As of: 04/01/2026, 05:27:00</span></span>
    </td>
  </tr>
  <tr>
    <td class="crsheader"></td>
    <td class="crsheader">2</td>
    <td class="crsheader" colspan="5">
      <a href="javascript:openNewWindow('http://www.ucsd.edu/catalog/courses/MATH.html#math2')">
        <span class="boldtxt">Intro to College Mathematics</span>
      </a>
      ( 4 Units)
    </td>
    <td class="crsheader" colspan="6" align="right">Prerequisites | Evaluations</td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">84897</td>
    <td class="brdr"><span id="insTyp" title="Independent Study">IN</span></td>
    <td class="brdr">A01</td>
    <td class="brdr" colspan="4" align="center">TBA</td>
    <td class="brdr"></td>
    <td class="brdr">Available text must be ignored</td>
    <td class="brdr">Limit text must be ignored</td>
    <td class="brdr"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">84898</td>
    <td class="brdr"><span id="insTyp" title="Independent Study">IN</span></td>
    <td class="brdr">A02</td>
    <td class="brdr" colspan="4" align="center">ARRANGED</td>
    <td class="brdr"><a href="#!">Noether, Emmy</a></td>
    <td class="brdr">&nbsp;</td>
    <td class="brdr">&nbsp;</td>
    <td class="brdr"></td>
  </tr>
</table>
`;

const bildFinalFixture = `
<table id="socDeptTab">
  <tr>
    <td colspan="13">
      <h2><span class="centeralign">Biology (BILD )</span></h2>
    </td>
  </tr>
  <tr>
    <td class="crsheader"></td>
    <td class="crsheader">4</td>
    <td class="crsheader" colspan="5">
      <span class="boldtxt">Introductory Biology Lab</span>
      ( 4 Units)
    </td>
    <td class="crsheader" colspan="6"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"><span id="insTyp" title="Lecture">LE</span></td>
    <td class="brdr">A00</td>
    <td class="brdr">TuTh</td>
    <td class="brdr">11:00a-12:20p</td>
    <td class="brdr">RWAC</td>
    <td class="brdr">0103</td>
    <td class="brdr"><a href="#!">Gonzalez Gamboa, Ivonne</a></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">261558</td>
    <td class="brdr"><span id="insTyp" title="Laboratory">LA</span></td>
    <td class="brdr">A01</td>
    <td class="brdr">TuTh</td>
    <td class="brdr">1:00p-3:50p</td>
    <td class="brdr">TATA</td>
    <td class="brdr">2301</td>
    <td class="brdr"><a href="#!">Gonzalez Gamboa, Ivonne</a></td>
    <td class="brdr">1</td>
    <td class="brdr">24</td>
    <td class="brdr"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">261559</td>
    <td class="brdr"><span id="insTyp" title="Laboratory">LA</span></td>
    <td class="brdr">A02</td>
    <td class="brdr">TuTh</td>
    <td class="brdr">1:00p-3:50p</td>
    <td class="brdr">TATA</td>
    <td class="brdr">2302</td>
    <td class="brdr"><a href="#!">Gonzalez Gamboa, Ivonne</a></td>
    <td class="brdr">2</td>
    <td class="brdr">24</td>
    <td class="brdr"></td>
  </tr>
  <tr class="nonenrtxt">
    <td class="brdr" colspan="13">Students who enroll in BILD 4 will be charged a lab fee of $40.00.</td>
  </tr>
  <tr class="nonenrtxt">
    <td class="brdr" colspan="2"></td>
    <td class="brdr"></td>
    <td class="brdr"><span id="insTyp" title="Final">FI</span></td>
    <td class="brdr">08/01/2026</td>
    <td class="brdr">S</td>
    <td class="brdr">11:30a-2:29p</td>
    <td class="brdr">RWAC</td>
    <td class="brdr">0103</td>
    <td class="brdr"></td>
    <td class="brdr" colspan="3">&nbsp;</td>
  </tr>
</table>
`;

const multiFamilyFinalFixture = `
<table id="socDeptTab">
  <tr>
    <td colspan="13">
      <h2><span class="centeralign">Mathematics (MATH )</span></h2>
    </td>
  </tr>
  <tr>
    <td class="crsheader"></td>
    <td class="crsheader">10B</td>
    <td class="crsheader" colspan="5">
      <span class="boldtxt">Calculus II</span>
      ( 4 Units)
    </td>
    <td class="crsheader" colspan="6"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"><span id="insTyp" title="Lecture">LE</span></td>
    <td class="brdr">A00</td>
    <td class="brdr">MWF</td>
    <td class="brdr">10:00a-10:50a</td>
    <td class="brdr">LEDDN</td>
    <td class="brdr">AUD</td>
    <td class="brdr"><a href="#!">Bowers, Adam R.</a></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">929759</td>
    <td class="brdr"><span id="insTyp" title="Discussion">DI</span></td>
    <td class="brdr">A01</td>
    <td class="brdr">W</td>
    <td class="brdr">4:00p-4:50p</td>
    <td class="brdr">APM</td>
    <td class="brdr">2301</td>
    <td class="brdr"><a href="#!">Bowers, Adam R.</a></td>
    <td class="brdr">FULL<br>Waitlist(4)</td>
    <td class="brdr">36</td>
    <td class="brdr"></td>
  </tr>
  <tr class="nonenrtxt">
    <td class="brdr" colspan="2"></td>
    <td class="brdr"></td>
    <td class="brdr"><span id="insTyp" title="Final">FI</span></td>
    <td class="brdr">12/12/2025</td>
    <td class="brdr">F</td>
    <td class="brdr">8:00a-10:59a</td>
    <td class="brdr">LEDDN</td>
    <td class="brdr">AUD</td>
    <td class="brdr"></td>
    <td class="brdr" colspan="3"></td>
  </tr>
  <tr>
    <td class="crsheader"></td>
    <td class="crsheader">10B</td>
    <td class="crsheader" colspan="5">
      <span class="boldtxt">Calculus II</span>
      ( 4 Units)
    </td>
    <td class="crsheader" colspan="6"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"><span id="insTyp" title="Lecture">LE</span></td>
    <td class="brdr">B00</td>
    <td class="brdr">MWF</td>
    <td class="brdr">12:00p-12:50p</td>
    <td class="brdr">MOS</td>
    <td class="brdr">0114</td>
    <td class="brdr"><a href="#!">Briones, Jor-el Thomas Caparas</a></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">929767</td>
    <td class="brdr"><span id="insTyp" title="Discussion">DI</span></td>
    <td class="brdr">B01</td>
    <td class="brdr">W</td>
    <td class="brdr">4:00p-4:50p</td>
    <td class="brdr">WLH</td>
    <td class="brdr">2209</td>
    <td class="brdr"><a href="#!">Briones, Jor-el Thomas Caparas</a></td>
    <td class="brdr">FULL<br>Waitlist(1)</td>
    <td class="brdr">32</td>
    <td class="brdr"></td>
  </tr>
  <tr class="nonenrtxt">
    <td class="brdr" colspan="2"></td>
    <td class="brdr"></td>
    <td class="brdr"><span id="insTyp" title="Final">FI</span></td>
    <td class="brdr">12/11/2025</td>
    <td class="brdr">Th</td>
    <td class="brdr">11:30a-2:29p</td>
    <td class="brdr">MOS</td>
    <td class="brdr">0114</td>
    <td class="brdr"></td>
    <td class="brdr" colspan="3"></td>
  </tr>
  <tr>
    <td class="crsheader"></td>
    <td class="crsheader">10B</td>
    <td class="crsheader" colspan="5">
      <span class="boldtxt">Calculus II</span>
      ( 4 Units)
    </td>
    <td class="crsheader" colspan="6"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"><span id="insTyp" title="Lecture">LE</span></td>
    <td class="brdr">C00</td>
    <td class="brdr">MWF</td>
    <td class="brdr">4:00p-4:50p</td>
    <td class="brdr">CENTR</td>
    <td class="brdr">101</td>
    <td class="brdr"><a href="#!">Huang, Lei</a></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">929778</td>
    <td class="brdr"><span id="insTyp" title="Discussion">DI</span></td>
    <td class="brdr">C01</td>
    <td class="brdr">W</td>
    <td class="brdr">5:00p-5:50p</td>
    <td class="brdr">HSS</td>
    <td class="brdr">1305</td>
    <td class="brdr"><a href="#!">Huang, Lei</a></td>
    <td class="brdr">FULL<br>Waitlist(0)</td>
    <td class="brdr">35</td>
    <td class="brdr"></td>
  </tr>
  <tr class="nonenrtxt">
    <td class="brdr" colspan="2"></td>
    <td class="brdr"></td>
    <td class="brdr"><span id="insTyp" title="Final">FI</span></td>
    <td class="brdr">12/09/2025</td>
    <td class="brdr">Tu</td>
    <td class="brdr">3:00p-5:59p</td>
    <td class="brdr">CENTR</td>
    <td class="brdr">101</td>
    <td class="brdr"></td>
    <td class="brdr" colspan="3"></td>
  </tr>
</table>
`;

const preHeaderNoteFixture = `
<table id="socDeptTab">
  <tr>
    <td class="crsheader"></td>
    <td class="crsheader">97</td>
    <td colspan="11" class="crsheader">Academic Internship</td>
  </tr>
  <tr>
    <td class="nonenrtxt" colspan="2"></td>
    <td class="nonenrtxt" colspan="11">
      <span class="ertext">Eligibility requirements are 30 units completed and 3.0 minimum UC gpa</span>
    </td>
  </tr>
  <tr>
    <td class="crsheader">
      <span id="crsRestCd" title="Open to Freshmen Only">FR</span>
    </td>
    <td class="crsheader">97</td>
    <td class="crsheader" colspan="5">
      <a href="javascript:openNewWindow('http://www.ucsd.edu/catalog/courses/AIP.html#aip97')">
        <span class="boldtxt">Academic Internship</span>
      </a>
      ( 2/4 by 2 Units)
    </td>
    <td class="crsheader" colspan="6"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">45088</td>
    <td class="brdr"><span id="insTyp" title="">IT</span></td>
    <td class="brdr">001</td>
    <td class="brdr" colspan="4" align="center">TBA</td>
    <td class="brdr"><a href="#!">Powell, Lora</a></td>
    <td class="brdr">Unlim</td>
    <td class="brdr"></td>
    <td class="brdr"></td>
  </tr>
</table>
`;

describe('UCSD Schedule of Classes parser', () => {
  it('parses CSE sections with stable IDs, shared lecture meetings, instructors, availability, and safe raw fields', () => {
    const parsed = parseScheduleOfClassesHtml(cseFixture, {
      subject: 'CSE',
      term: 'SP26',
      sourceUrl,
      fetchedAt,
    });

    expect(parsed.source_timestamp).toBe('04/01/2026, 05:27:00');
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0]).toMatchObject({
      course_id: 'CSE:5',
      subject: 'CSE',
      course_number: '5',
      title: 'Intro to Programming',
      units: '4',
      catalog_url: 'http://www.ucsd.edu/catalog/courses/CSE.html#cse5',
    });

    const [section] = parsed.courses[0]!.sections;
    expect(section).toMatchObject({
      section_id: 'SP26:252174',
      course_id: 'CSE:5',
      section_code: 'A01',
      meeting_type: 'Discussion',
      instructors: ['Bonjour, Trevor'],
      enrolled: 146,
      capacity: 146,
      waitlist_count: 1,
      meetings: [
        {
          days: ['Tuesday', 'Thursday'],
          start_time: '15:30',
          end_time: '16:50',
          building: 'CENTR',
          room: '109',
          is_tba: false,
          meeting_type: 'Lecture',
          raw_days: 'TuTh',
          raw_time: '3:30p-4:50p',
          raw_location: 'CENTR 109',
        },
        {
          days: ['Monday'],
          start_time: '16:00',
          end_time: '16:50',
          building: 'CENTR',
          room: '212',
          is_tba: false,
          meeting_type: 'Discussion',
          raw_days: 'M',
          raw_time: '4:00p-4:50p',
          raw_location: 'CENTR 212',
        },
      ],
      raw: {
        source: 'ucsd_schedule_of_classes',
        source_url: sourceUrl,
        fetched_at: fetchedAt,
        raw_term: 'SP26',
        raw_subject: 'CSE',
        raw_course_number: '5',
        raw_section_identifier: '252174',
        raw_section_code: 'A01',
        raw_meeting_type: 'DI',
      },
    });
  });

  it('parses MATH TBA and arranged sections without inventing instructor or time data', () => {
    const parsed = parseScheduleOfClassesHtml(mathFixture, {
      subject: 'MATH',
      term: 'SP26',
      sourceUrl,
      fetchedAt,
    });

    expect(parsed.courses[0]!.course_id).toBe('MATH:2');
    expect(parsed.courses[0]!.sections).toMatchObject([
      {
        section_id: 'SP26:84897',
        section_code: 'A01',
        instructors: [],
        enrolled: null,
        capacity: null,
        waitlist_count: 0,
        meetings: [
          {
            days: [],
            start_time: null,
            end_time: null,
            building: null,
            room: null,
            is_tba: true,
            meeting_type: 'Independent Study',
            raw_days: 'TBA',
            raw_time: 'TBA',
            raw_location: 'TBA',
          },
        ],
      },
      {
        section_id: 'SP26:84898',
        section_code: 'A02',
        instructors: ['Noether, Emmy'],
        enrolled: null,
        capacity: null,
        waitlist_count: 0,
        meetings: [
          {
            days: [],
            start_time: null,
            end_time: null,
            building: null,
            room: null,
            is_tba: true,
            meeting_type: 'Independent Study',
            raw_days: 'ARRANGED',
            raw_time: 'ARRANGED',
            raw_location: 'ARRANGED',
          },
        ],
      },
    ]);
  });

  it('attaches trailing non-enrolled final exam rows to existing sections', () => {
    const parsed = parseScheduleOfClassesHtml(bildFinalFixture, {
      subject: 'BILD',
      term: 'S126',
      sourceUrl,
      fetchedAt,
    });

    const course = parsed.courses.at(0)!;
    const { sections } = course;
    expect(sections.map((section) => section.section_code)).toEqual([
      'A01',
      'A02',
    ]);

    for (const section of sections) {
      expect(section.meetings).toMatchObject([
        {
          meeting_type: 'Lecture',
          raw_time: '11:00a-12:20p',
          raw_location: 'RWAC 0103',
        },
        {
          meeting_type: 'Laboratory',
          raw_time: '1:00p-3:50p',
        },
        {
          meeting_type: 'Final',
          date: '2026-08-01',
          days: ['Saturday'],
          start_time: '11:30',
          end_time: '14:29',
          raw_time: '11:30a-2:29p',
          raw_location: 'RWAC 0103',
        },
      ]);
      expect(
        section.meetings.some((meeting) =>
          meeting.meeting_type?.includes('lab fee'),
        ),
      ).toBe(false);
    }
  });

  it('keeps non-enrolled final exam rows within their repeated lecture family', () => {
    const parsed = parseScheduleOfClassesHtml(multiFamilyFinalFixture, {
      subject: 'MATH',
      term: 'FA25',
      sourceUrl,
      fetchedAt,
    });

    const { sections } = parsed.courses.at(0)!;
    expect(sections.map((section) => section.section_code)).toEqual([
      'A01',
      'B01',
      'C01',
    ]);

    expect(
      sections.map((section) =>
        section.meetings
          .filter((meeting) => meeting.meeting_type === 'Final')
          .map((meeting) => ({
            section: section.section_code,
            date: meeting.date,
            time: meeting.raw_time,
            location: meeting.raw_location,
          })),
      ),
    ).toEqual([
      [
        {
          section: 'A01',
          date: '2025-12-12',
          time: '8:00a-10:59a',
          location: 'LEDDN AUD',
        },
      ],
      [
        {
          section: 'B01',
          date: '2025-12-11',
          time: '11:30a-2:29p',
          location: 'MOS 0114',
        },
      ],
      [
        {
          section: 'C01',
          date: '2025-12-09',
          time: '3:00p-5:59p',
          location: 'CENTR 101',
        },
      ],
    ]);
  });

  it('ignores pre-header note rows until the full course header appears', () => {
    const parsed = parseScheduleOfClassesHtml(preHeaderNoteFixture, {
      subject: 'AIP',
      term: 'FA25',
      sourceUrl,
      fetchedAt,
    });

    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0]).toMatchObject({
      course_id: 'AIP:97',
      course_number: '97',
      title: 'Academic Internship',
      catalog_url: 'http://www.ucsd.edu/catalog/courses/AIP.html#aip97',
    });
    expect(parsed.courses[0]!.sections).toMatchObject([
      {
        section_id: 'FA25:45088',
        section_code: '001',
        meeting_type: 'IT',
        instructors: ['Powell, Lora'],
        meetings: [
          {
            meeting_type: 'IT',
            is_tba: true,
            raw_location: 'TBA',
          },
        ],
      },
    ]);
  });

  it('builds a valid Catalog Snapshot with availability data from parsed CSE and MATH schedule courses', () => {
    const config = makeConfig();
    const cse = parseScheduleOfClassesHtml(cseFixture, {
      subject: 'CSE',
      term: config.active_planning_term,
      sourceUrl,
      fetchedAt,
    });
    const math = parseScheduleOfClassesHtml(mathFixture, {
      subject: 'MATH',
      term: config.active_planning_term,
      sourceUrl,
      fetchedAt,
    });

    const snapshot = buildScheduleCatalogSnapshot(config, [cse, math], {
      runId: 'run-schedule',
      generatedAt: fetchedAt,
    });

    expect(validateCatalogSnapshot(snapshot, config)).toEqual({
      success: true,
      errors: [],
    });
    expect(snapshot.source_timestamps.schedule_of_classes).toBe(
      '04/01/2026, 05:27:00',
    );

    const cseSection = snapshot.courses.find((c) => c.course_id === 'CSE:5')
      ?.sections[0];
    expect(cseSection).toMatchObject({
      enrolled: 146,
      capacity: 146,
      waitlist_count: 1,
    });

    const mathSections = snapshot.courses.find(
      (c) => c.course_id === 'MATH:2',
    )?.sections;
    for (const section of mathSections ?? []) {
      expect(section.enrolled).toBeNull();
      expect(section.capacity).toBeNull();
      expect(section.waitlist_count).toBe(0);
    }
  });
});

const availabilityFixture = `
<table id="socDeptTab">
  <tr>
    <td colspan="13">
      <h2><span class="centeralign">Physics (PHYS )</span></h2>
    </td>
  </tr>
  <tr>
    <td class="crsheader"></td>
    <td class="crsheader">1A</td>
    <td class="crsheader" colspan="5">
      <span class="boldtxt">Mechanics</span>
      ( 4 Units)
    </td>
    <td class="crsheader" colspan="6"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">300001</td>
    <td class="brdr"><span id="insTyp" title="Lecture">LE</span></td>
    <td class="brdr">A01</td>
    <td class="brdr">MWF</td>
    <td class="brdr">10:00a-10:50a</td>
    <td class="brdr">YORK</td>
    <td class="brdr">2722</td>
    <td class="brdr"><a href="#!">Feynman, Richard</a></td>
    <td class="brdr">50</td>
    <td class="brdr">200</td>
    <td class="brdr"></td>
  </tr>
  <tr class="sectxt">
    <td class="brdr"></td>
    <td class="brdr"></td>
    <td class="brdr">300002</td>
    <td class="brdr"><span id="insTyp" title="Lecture">LE</span></td>
    <td class="brdr">B01</td>
    <td class="brdr">TuTh</td>
    <td class="brdr">2:00p-3:20p</td>
    <td class="brdr">WLH</td>
    <td class="brdr">2001</td>
    <td class="brdr"><a href="#!">Dirac, Paul</a></td>
    <td class="brdr">FULL</td>
    <td class="brdr">150</td>
    <td class="brdr"></td>
  </tr>
</table>
`;

describe('UCSD Schedule of Classes availability parsing', () => {
  it('parses numeric available seats as enrolled = capacity - available', () => {
    const parsed = parseScheduleOfClassesHtml(availabilityFixture, {
      subject: 'PHYS',
      term: 'SP26',
      sourceUrl,
      fetchedAt,
    });

    const sectionA = parsed.courses[0]!.sections.find(
      (s) => s.section_code === 'A01',
    );
    expect(sectionA).toMatchObject({
      enrolled: 150,
      capacity: 200,
      waitlist_count: 0,
    });
  });

  it('parses FULL without waitlist as enrolled = capacity', () => {
    const parsed = parseScheduleOfClassesHtml(availabilityFixture, {
      subject: 'PHYS',
      term: 'SP26',
      sourceUrl,
      fetchedAt,
    });

    const sectionB = parsed.courses[0]!.sections.find(
      (s) => s.section_code === 'B01',
    );
    expect(sectionB).toMatchObject({
      enrolled: 150,
      capacity: 150,
      waitlist_count: 0,
    });
  });

  it('parses FULL with Waitlist(N) from the CSE fixture', () => {
    const parsed = parseScheduleOfClassesHtml(cseFixture, {
      subject: 'CSE',
      term: 'SP26',
      sourceUrl,
      fetchedAt,
    });

    expect(parsed.courses[0]!.sections[0]).toMatchObject({
      enrolled: 146,
      capacity: 146,
      waitlist_count: 1,
    });
  });

  it('returns null enrolled/capacity for sections with non-numeric availability text', () => {
    const parsed = parseScheduleOfClassesHtml(mathFixture, {
      subject: 'MATH',
      term: 'SP26',
      sourceUrl,
      fetchedAt,
    });

    for (const section of parsed.courses[0]!.sections) {
      expect(section.enrolled).toBeNull();
      expect(section.capacity).toBeNull();
      expect(section.waitlist_count).toBe(0);
    }
  });
});

describe('UCSD Schedule of Classes fetcher', () => {
  it('resolves UCSD subject codes for the term and posts the subject search form', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];

    const parsed = await fetchScheduleOfClassesForSubjects(['CSE', 'MATH'], {
      term: 'SP26',
      fetch(url, init) {
        const urlText = requestUrlText(url);
        requests.push({ url: urlText, init });
        if (urlText.endsWith('subject-list.json?selectedTerm=SP26')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  code: 'CSE ',
                  value: 'CSE  - Computer Science & Engineering',
                },
                { code: 'MATH', value: 'MATH - Mathematics' },
              ]),
              { status: 200 },
            ),
          );
        }
        const body = init?.body as URLSearchParams;
        const subject = body.get('selectedSubjects')?.trim();
        return Promise.resolve(
          new Response(subject === 'CSE' ? cseFixture : mathFixture, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          }),
        );
      },
      fetchedAt,
    });

    const bodies = requests
      .filter((request) => request.init?.method === 'POST')
      .map((request) => request.init!.body as URLSearchParams);

    expect(bodies.map((body) => body.get('selectedSubjects'))).toEqual([
      'CSE ',
      'MATH',
    ]);
    expect(parsed.map((result) => result.subject)).toEqual(['CSE', 'MATH']);
  });

  it('fetches and parses paginated Schedule of Classes result pages', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];

    const [parsed] = await fetchScheduleOfClassesForSubjects(['CSE'], {
      term: 'SP26',
      fetch(url, init) {
        const urlText = requestUrlText(url);
        requests.push({ url: urlText, init });
        if (urlText.endsWith('subject-list.json?selectedTerm=SP26')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  code: 'CSE ',
                  value: 'CSE  - Computer Science & Engineering',
                },
              ]),
              { status: 200 },
            ),
          );
        }
        if (urlText.endsWith('scheduleOfClassesStudentResult.htm?page=2')) {
          return Promise.resolve(
            new Response(cseSecondPageFixture, {
              status: 200,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
              },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            `${cseFixture}<div>Page  (1&nbsp;of&nbsp;2)</div><a href="scheduleOfClassesStudentResult.htm?page=2">2</a>`,
            {
              status: 200,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Set-Cookie': 'jlinksessionidx=test-session; Path=/',
              },
            },
          ),
        );
      },
      fetchedAt,
    });

    expect(
      requests.some((request) =>
        request.url.endsWith('scheduleOfClassesStudentResult.htm?page=2'),
      ),
    ).toBe(true);
    expect(parsed?.courses.map((course) => course.course_number)).toEqual([
      '5',
      '30',
    ]);
  });

  it('reuses an injected subject list instead of refetching it per subject', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];

    await fetchScheduleOfClassesForSubjects(['CSE', 'MATH'], {
      term: 'SP26',
      subjectList: {
        url: 'https://act.ucsd.edu/scheduleOfClasses/subject-list.json?selectedTerm=SP26',
        raw: JSON.stringify([
          { code: 'CSE ', value: 'CSE  - Computer Science & Engineering' },
          { code: 'MATH', value: 'MATH - Mathematics' },
        ]),
        subjects: [
          { code: 'CSE ', value: 'CSE  - Computer Science & Engineering' },
          { code: 'MATH', value: 'MATH - Mathematics' },
        ],
      },
      fetch(url, init) {
        const urlText = requestUrlText(url);
        requests.push({ url: urlText, init });
        const body = init?.body as URLSearchParams;
        const subject = body.get('selectedSubjects')?.trim();
        return Promise.resolve(
          new Response(subject === 'CSE' ? cseFixture : mathFixture, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          }),
        );
      },
      fetchedAt,
    });

    expect(
      requests.filter((request) => request.url.includes('subject-list.json')),
    ).toEqual([]);
    expect(
      requests
        .filter((request) => request.init?.method === 'POST')
        .map((request) =>
          (request.init!.body as URLSearchParams).get('selectedSubjects'),
        ),
    ).toEqual(['CSE ', 'MATH']);
  });
});
