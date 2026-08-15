import { describe, expect, it } from 'vitest';
import {
  fetchGeneralCatalogForSubjects,
  fetchGeneralCatalogForSubject,
  parseGeneralCatalogHtml,
} from './generalCatalog';

function requestUrlText(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const cseFixture = `
<main>
  <p class="anchor-parent"><a class="anchor" id="cse101" name="cse101"></a></p>
  <p class="course-name">CSE 101. Design and Analysis of Algorithms (4)</p>
  <p class="course-descriptions">Design and analysis of efficient algorithms with emphasis on sorting, searching, pattern matching, and graph algorithms. <strong class="italic"><em>Prerequisites:</em> </strong>CSE 21 or MATH 154 and CSE 12 or DSC 30; restricted to undergraduates.</p>
  <p class="anchor-parent"><a class="anchor" id="cse110" name="cse110"></a></p>
  <p class="course-name">CSE 110. Software Engineering (4)</p>
  <p class="course-descriptions">Introduction to software development and engineering methods, including specification, design, implementation, testing, and process.</p>
</main>
`;

const mathFixture = `
<main>
  <p class="anchor-parent"><a class="anchor" id="math20a" name="math20a"></a></p>
  <p class="course-name">MATH 20A. Calculus for Science and Engineering (4)</p>
  <p class="course-descriptions">Foundations of differential and integral calculus of one variable. Functions, graphs, continuity, limits, derivative, tangent line. Applications with algebraic, exponential, logarithmic, and trigonometric functions. <strong class="italic"><em>Prerequisites:</em></strong> Math Placement Exam qualifying score, or AP Calculus AB score of 3. <strong><em>Restrictions:</em></strong> Students may not receive credit for both MATH 20A and MATH 10B.</p>
  <p class="anchor-parent"><a class="anchor" id="math103a" name="math103a"></a></p>
  <p class="course-name">MATH 103A. Modern Algebra I (4)</p>
  <p class="course-descriptions">First course in a two-quarter introduction to abstract algebra with some applications. Emphasis on group theory. Topics include definitions, properties of isomorphisms, and subgroups. <strong class="italic"><em>Prerequisites:</em></strong> MATH 31CH or MATH 109 or consent of instructor.</p>
</main>
`;

const biologyFixture = `
<main>
  <p class="anchor-parent"><a class="anchor" id="bild1" name="bild1"></a></p>
  <p class="course-name">BILD 1. The Cell (4)</p>
  <p class="course-descriptions">Introduction to cellular biology.</p>
  <p class="anchor-parent"><a class="anchor" id="bipn156" name="bipn156"></a></p>
  <p class="course-name">BIPN 156. Glial Neurobiology (4)</p>
  <p class="course-descriptions">Molecular and cellular biology of glial cells in nervous system function.</p>
</main>
`;

const dscFixture = `
<main>
  <p class="anchor-parent"><a class="anchor" id="dsc20" name="dsc20"></a></p>
  <p class="anchor-parent"><a class="anchor" id="dsc20r" name="dsc20r"></a></p>
  <p class="course-name">DSC 20/R. Programming and Basic Data Structures for Data Science (4)</p>
  <p class="course-descriptions">Provides an understanding of the structures that underlie the programs, algorithms, and languages used in data science. <strong><em>Prerequisites:</em></strong> DSC 10/R.</p>
  <p class="anchor-parent"><a class="anchor" id="dsc40b" name="dsc40b"></a></p>
  <p class="anchor-parent"><a class="anchor" id="dsc40r" name="dsc40r"></a></p>
  <p class="course-name">DSC 40B/R. Theoretical Foundations of Data Science II (4)</p>
  <p>The sequence DSC 40A/R-B/R introduces the theoretical foundations of data science. <strong><em>Prerequisites:</em></strong> DSC 20/R and 40A/R.</p>
  <p class="anchor-parent"><a class="anchor" id="dsc80" name="dsc80"></a></p>
  <p class="anchor-parent"><a class="anchor" id="dsc80r" name="dsc80r"></a></p>
  <p class="course-name">DSC 80/R. The Practice and Application of Data Science (4)</p>
  <p class="course-descriptions">Students master the data science life-cycle. <strong><em>Prerequisites:</em></strong> DSC 30/R and DSC 40A/R.</p>
</main>
`;

const crossListedFixture = `
<main>
  <p class="anchor-parent"><a class="anchor" id="beng181" name="beng181"></a></p>
  <p class="course-name">BENG/BIMM/CSE 181. Molecular Sequence Analysis (4)</p>
  <p class="course-descriptions">This course covers the analysis of nucleic acid and protein sequences. <strong><em>Prerequisites:</em></strong> CSE 100.</p>
  <p class="anchor-parent"><a class="anchor" id="beng242" name="beng242"></a></p>
  <p class="course-name">BENG 242/MATS 257/NANO 257. Polymer Science and Engineering (4)</p>
  <p class="course-descriptions">Quantitative basic understanding of different branches of polymer science.</p>
  <p class="anchor-parent"><a class="anchor" id="cse256" name="cse256"></a></p>
  <p class="course-name">CSE 256/LING 256. Statistical Natural Language Processing (4)</p>
  <p class="course-descriptions">An introduction to modern statistical approaches to natural language processing.</p>
  <p class="anchor-parent"><a class="anchor" id="beng191" name="beng191"></a></p>
  <p class="anchor-parent"><a class="anchor" id="beng291" name="beng291"></a></p>
  <p class="course-name">BENG 191/291. Senior Seminar I: Professional Issues in Bioengineering (2)</p>
  <p class="course-descriptions">Seminar on professional issues in bioengineering.</p>
</main>
`;

const catalogSequenceFixture = `
<main>
  <p class="anchor-parent"><a class="anchor" id="bggn249a" name="bggn249a"></a></p>
  <p class="anchor-parent"><a class="anchor" id="bggn249b" name="bggn249b"></a></p>
  <p class="anchor-parent"><a class="anchor" id="bggn249c" name="bggn249c"></a></p>
  <p class="course-name">BGGN 249A-B-C. Basic Neuroscience (4-4-4)</p>
  <p class="course-descriptions">Basic neuroscience sequence.</p>
  <p class="anchor-parent"><a class="anchor" id="ece145al" name="ece145al"></a></p>
  <p class="anchor-parent"><a class="anchor" id="ece145bl" name="ece145bl"></a></p>
  <p class="anchor-parent"><a class="anchor" id="ece145cl" name="ece145cl"></a></p>
  <p class="course-name">ECE 145AL-BL-CL. Acoustics Laboratory (4-4-4)</p>
  <p class="course-descriptions">Acoustics laboratory sequence.</p>
  <p class="anchor-parent"><a class="anchor" id="vis128a" name="vis128a"></a></p>
  <p class="anchor-parent"><a class="anchor" id="vis128b" name="vis128b"></a></p>
  <p class="anchor-parent"><a class="anchor" id="vis128c" name="vis128c"></a></p>
  <p class="anchor-parent"><a class="anchor" id="vis128d" name="vis128d"></a></p>
  <p class="anchor-parent"><a class="anchor" id="vis128e" name="vis128e"></a></p>
  <p class="course-name">VIS 128A–E. Topics in Art History and Theory (4)</p>
  <p class="course-descriptions">Topics in art history and theory.</p>
  <p class="anchor-parent"><a class="anchor" id="poli5r" name="poli5r"></a></p>
  <p class="anchor-parent"><a class="anchor" id="poli5dr" name="poli5dr"></a></p>
  <p class="anchor-parent"><a class="anchor" id="econ5r" name="econ5r"></a></p>
  <p class="course-name">POLI 5R, POLI 5DR, ECON 5R. Data Analytics for the Social Sciences (4)</p>
  <p class="course-descriptions">Data analytics for social science.</p>
</main>
`;

describe('UCSD General Catalog parser', () => {
  it('parses CSE course metadata and preserves raw prerequisite text', () => {
    const courses = parseGeneralCatalogHtml(cseFixture, {
      subject: 'CSE',
      sourceUrl: 'https://catalog.ucsd.edu/courses/CSE.html',
    });

    expect(courses).toEqual([
      {
        course_id: 'CSE:101',
        subject: 'CSE',
        course_number: '101',
        title: 'Design and Analysis of Algorithms',
        units: '4',
        description:
          'Design and analysis of efficient algorithms with emphasis on sorting, searching, pattern matching, and graph algorithms.',
        prerequisites_text:
          'CSE 21 or MATH 154 and CSE 12 or DSC 30; restricted to undergraduates.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/CSE.html#cse101',
      },
      {
        course_id: 'CSE:110',
        subject: 'CSE',
        course_number: '110',
        title: 'Software Engineering',
        units: '4',
        description:
          'Introduction to software development and engineering methods, including specification, design, implementation, testing, and process.',
        prerequisites_text: null,
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/CSE.html#cse110',
      },
    ]);
  });

  it('parses MATH course metadata with separate labeled restrictions', () => {
    const courses = parseGeneralCatalogHtml(mathFixture, {
      subject: 'MATH',
      sourceUrl: 'https://catalog.ucsd.edu/courses/MATH.html',
    });

    expect(courses[0]).toEqual({
      course_id: 'MATH:20A',
      subject: 'MATH',
      course_number: '20A',
      title: 'Calculus for Science and Engineering',
      units: '4',
      description:
        'Foundations of differential and integral calculus of one variable. Functions, graphs, continuity, limits, derivative, tangent line. Applications with algebraic, exponential, logarithmic, and trigonometric functions.',
      prerequisites_text:
        'Math Placement Exam qualifying score, or AP Calculus AB score of 3.',
      restrictions_text:
        'Students may not receive credit for both MATH 20A and MATH 10B.',
      catalog_url: 'https://catalog.ucsd.edu/courses/MATH.html#math20a',
    });
    expect(courses[1]).toMatchObject({
      course_id: 'MATH:103A',
      prerequisites_text: 'MATH 31CH or MATH 109 or consent of instructor.',
    });
  });

  it('filters grouped catalog pages to the requested subject', () => {
    const courses = parseGeneralCatalogHtml(biologyFixture, {
      subject: 'BIPN',
      sourceUrl: 'https://catalog.ucsd.edu/courses/BIOL.html',
    });

    expect(courses).toEqual([
      {
        course_id: 'BIPN:156',
        subject: 'BIPN',
        course_number: '156',
        title: 'Glial Neurobiology',
        units: '4',
        description:
          'Molecular and cellular biology of glial cells in nervous system function.',
        prerequisites_text: null,
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/BIOL.html#bipn156',
      },
    ]);
  });

  it('parses catalog course names when the course number is not followed by a period', () => {
    const fixture = `
      <main>
        <p class="anchor-parent"><a class="anchor" id="comm114m" name="comm114m"></a></p>
        <p class="course-name">COMM 114M CSI: Communication and the Law (4)</p>
        <p class="course-descriptions">Examines how law and communication shape public life.</p>
      </main>
    `;
    const courses = parseGeneralCatalogHtml(fixture, {
      subject: 'COMM',
      sourceUrl: 'https://catalog.ucsd.edu/courses/COMM.html',
    });

    expect(courses).toEqual([
      {
        course_id: 'COMM:114M',
        subject: 'COMM',
        course_number: '114M',
        title: 'CSI: Communication and the Law',
        units: '4',
        description: 'Examines how law and communication shape public life.',
        prerequisites_text: null,
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/COMM.html#comm114m',
      },
    ]);
  });

  it('parses grouped catalog course names with the subject code in parentheses', () => {
    const fixture = `
      <main>
        <p class="anchor-parent"><a class="anchor" id="lisl1a" name="lisl1a"></a></p>
        <p class="course-name">Linguistics/American Sign Language (LISL) 1A. American Sign Language Conversation (2.5)</p>
        <p class="course-descriptions">Small tutorial meetings with a signer of American Sign Language. <strong><em>Prerequisites:</em></strong> no prior study of ASL.</p>
      </main>
    `;
    const courses = parseGeneralCatalogHtml(fixture, {
      subject: 'LISL',
      sourceUrl: 'https://catalog.ucsd.edu/courses/LING.html',
    });

    expect(courses).toEqual([
      {
        course_id: 'LISL:1A',
        subject: 'LISL',
        course_number: '1A',
        title: 'American Sign Language Conversation',
        units: '2.5',
        description:
          'Small tutorial meetings with a signer of American Sign Language.',
        prerequisites_text: 'no prior study of ASL.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/LING.html#lisl1a',
      },
    ]);
  });

  it('normalizes slash-R course numbers and accepts classless description paragraphs', () => {
    const courses = parseGeneralCatalogHtml(dscFixture, {
      subject: 'DSC',
      sourceUrl: 'https://catalog.ucsd.edu/courses/DSC.html',
    });

    expect(courses).toEqual([
      {
        course_id: 'DSC:20',
        subject: 'DSC',
        course_number: '20',
        title: 'Programming and Basic Data Structures for Data Science',
        units: '4',
        description:
          'Provides an understanding of the structures that underlie the programs, algorithms, and languages used in data science.',
        prerequisites_text: 'DSC 10/R.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/DSC.html#dsc20',
      },
      {
        course_id: 'DSC:20R',
        subject: 'DSC',
        course_number: '20R',
        title: 'Programming and Basic Data Structures for Data Science',
        units: '4',
        description:
          'Provides an understanding of the structures that underlie the programs, algorithms, and languages used in data science.',
        prerequisites_text: 'DSC 10/R.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/DSC.html#dsc20r',
      },
      {
        course_id: 'DSC:40B',
        subject: 'DSC',
        course_number: '40B',
        title: 'Theoretical Foundations of Data Science II',
        units: '4',
        description:
          'The sequence DSC 40A/R-B/R introduces the theoretical foundations of data science.',
        prerequisites_text: 'DSC 20/R and 40A/R.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/DSC.html#dsc40b',
      },
      {
        course_id: 'DSC:40BR',
        subject: 'DSC',
        course_number: '40BR',
        title: 'Theoretical Foundations of Data Science II',
        units: '4',
        description:
          'The sequence DSC 40A/R-B/R introduces the theoretical foundations of data science.',
        prerequisites_text: 'DSC 20/R and 40A/R.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/DSC.html#dsc40r',
      },
      {
        course_id: 'DSC:80',
        subject: 'DSC',
        course_number: '80',
        title: 'The Practice and Application of Data Science',
        units: '4',
        description: 'Students master the data science life-cycle.',
        prerequisites_text: 'DSC 30/R and DSC 40A/R.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/DSC.html#dsc80',
      },
      {
        course_id: 'DSC:80R',
        subject: 'DSC',
        course_number: '80R',
        title: 'The Practice and Application of Data Science',
        units: '4',
        description: 'Students master the data science life-cycle.',
        prerequisites_text: 'DSC 30/R and DSC 40A/R.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/DSC.html#dsc80r',
      },
    ]);
  });

  it('expands cross-listed catalog rows that share one course number', () => {
    const courses = parseGeneralCatalogHtml(crossListedFixture, {
      subject: 'BIMM',
      sourceUrl: 'https://catalog.ucsd.edu/courses/BENG.html',
    });

    expect(courses).toEqual([
      {
        course_id: 'BIMM:181',
        subject: 'BIMM',
        course_number: '181',
        title: 'Molecular Sequence Analysis',
        units: '4',
        description:
          'This course covers the analysis of nucleic acid and protein sequences.',
        prerequisites_text: 'CSE 100.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/BENG.html#beng181',
      },
    ]);
  });

  it('expands cross-listed catalog rows with distinct course numbers', () => {
    const courses = parseGeneralCatalogHtml(crossListedFixture, {
      subject: 'MATS',
      sourceUrl: 'https://catalog.ucsd.edu/courses/BENG.html',
    });

    expect(courses).toEqual([
      {
        course_id: 'MATS:257',
        subject: 'MATS',
        course_number: '257',
        title: 'Polymer Science and Engineering',
        units: '4',
        description:
          'Quantitative basic understanding of different branches of polymer science.',
        prerequisites_text: null,
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/BENG.html#beng242',
      },
    ]);
  });

  it('expands cross-listed catalog rows with slash-separated subject-number pairs', () => {
    const courses = parseGeneralCatalogHtml(crossListedFixture, {
      subject: 'LING',
      sourceUrl: 'https://catalog.ucsd.edu/courses/CSE.html',
    });

    expect(courses).toEqual([
      {
        course_id: 'LING:256',
        subject: 'LING',
        course_number: '256',
        title: 'Statistical Natural Language Processing',
        units: '4',
        description:
          'An introduction to modern statistical approaches to natural language processing.',
        prerequisites_text: null,
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/CSE.html#cse256',
      },
    ]);
  });

  it('expands catalog rows with one subject and multiple course numbers', () => {
    const courses = parseGeneralCatalogHtml(crossListedFixture, {
      subject: 'BENG',
      sourceUrl: 'https://catalog.ucsd.edu/courses/BENG.html',
    });

    expect(courses.map((course) => course.course_id)).toContain('BENG:191');
    expect(courses.map((course) => course.course_id)).toContain('BENG:291');
    expect(courses.find((course) => course.course_id === 'BENG:291')).toEqual({
      course_id: 'BENG:291',
      subject: 'BENG',
      course_number: '291',
      title: 'Senior Seminar I: Professional Issues in Bioengineering',
      units: '2',
      description: 'Seminar on professional issues in bioengineering.',
      prerequisites_text: null,
      restrictions_text: null,
      catalog_url: 'https://catalog.ucsd.edu/courses/BENG.html#beng291',
    });
  });

  it('expands hyphenated, ranged, and comma-separated catalog listings', () => {
    expect(
      parseGeneralCatalogHtml(catalogSequenceFixture, {
        subject: 'BGGN',
        sourceUrl: 'https://catalog.ucsd.edu/courses/BGGN.html',
      }).map((course) => course.course_id),
    ).toEqual(['BGGN:249A', 'BGGN:249B', 'BGGN:249C']);

    expect(
      parseGeneralCatalogHtml(catalogSequenceFixture, {
        subject: 'ECE',
        sourceUrl: 'https://catalog.ucsd.edu/courses/ECE.html',
      }).map((course) => course.course_id),
    ).toEqual(['ECE:145AL', 'ECE:145BL', 'ECE:145CL']);

    expect(
      parseGeneralCatalogHtml(catalogSequenceFixture, {
        subject: 'VIS',
        sourceUrl: 'https://catalog.ucsd.edu/courses/VIS.html',
      }).map((course) => course.course_id),
    ).toEqual(['VIS:128A', 'VIS:128B', 'VIS:128C', 'VIS:128D', 'VIS:128E']);

    expect(
      parseGeneralCatalogHtml(catalogSequenceFixture, {
        subject: 'POLI',
        sourceUrl: 'https://catalog.ucsd.edu/courses/POLI.html',
      }).map((course) => course.course_id),
    ).toEqual(['POLI:5R', 'POLI:5DR']);

    expect(
      parseGeneralCatalogHtml(catalogSequenceFixture, {
        subject: 'ECON',
        sourceUrl: 'https://catalog.ucsd.edu/courses/POLI.html',
      }).map((course) => course.course_id),
    ).toEqual(['ECON:5R']);
  });
});

describe('UCSD General Catalog fetcher', () => {
  it('fetches a configured subject from its UCSD catalog page', async () => {
    const requests: string[] = [];
    const courses = await fetchGeneralCatalogForSubject('CSE', {
      fetch(url) {
        requests.push(requestUrlText(url));
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

    expect(requests).toEqual(['https://catalog.ucsd.edu/courses/CSE.html']);
    expect(courses.map((course) => course.course_id)).toEqual([
      'CSE:101',
      'CSE:110',
    ]);
  });

  it('fetches a requested subject from a grouped UCSD catalog page', async () => {
    const requests: string[] = [];
    const courses = await fetchGeneralCatalogForSubject('BIPN', {
      catalogPage: 'BIOL',
      fetch(url) {
        requests.push(requestUrlText(url));
        return Promise.resolve(
          new Response(biologyFixture, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          }),
        );
      },
    });

    expect(requests).toEqual(['https://catalog.ucsd.edu/courses/BIOL.html']);
    expect(courses.map((course) => course.course_id)).toEqual(['BIPN:156']);
  });

  it('fetches each configured subject and returns combined catalog courses', async () => {
    const requestedSubjects: string[] = [];
    const courses = await fetchGeneralCatalogForSubjects(['CSE', 'MATH'], {
      fetch(url) {
        const urlText = requestUrlText(url);
        const subject = urlText.includes('MATH') ? 'MATH' : 'CSE';
        requestedSubjects.push(subject);
        return Promise.resolve(
          new Response(subject === 'MATH' ? mathFixture : cseFixture, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          }),
        );
      },
    });

    expect(requestedSubjects).toEqual(['CSE', 'MATH']);
    expect(courses.map((course) => course.subject)).toEqual([
      'CSE',
      'CSE',
      'MATH',
      'MATH',
    ]);
  });
});
