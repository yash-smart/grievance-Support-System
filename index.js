import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv"
import bcrypt from "bcrypt";
import session from "express-session";
import cookieParser from "cookie-parser";
import nodemailer from "nodemailer";

env.config();

console.log(process.env.EMAIL_PASSWORD);

const transporter = nodemailer.createTransport({
    service:'gmail',
    auth: {
        user:'smartyash334@gmail.com',
        pass:process.env.EMAIL_PASSWORD
    }
})

const app = express();

const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "grievance-support-system",
    password: process.env.DB_PASSWORD,
    port: 5432,
});
db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  rolling: true,
  cookie: { 
    secure: false, 
    maxAge: 3600000
} // Set secure to true in production with HTTPS
}));

app.get('/',(req,res) => {
    res.render('index.ejs');
})

app.get("/login",(req,res) => {
    if (req.session.user === undefined) {
        res.render("login.ejs")
    } else {
        res.redirect('/main/'+req.session.user);
    }
})

app.post('/login',async (req,res) => {
    try {
        let user_data = await db.query('select * from users where username=$1;',[req.body.Username.trim()]);
        if (user_data.rows.length>0) {
            let correct_password = user_data.rows[0].password;
            bcrypt.compare(req.body.Password, correct_password, function(err, result) {
                if (result) {
                    req.session.user = user_data.rows[0].user_id;
                    res.redirect('/main/'+req.session.user);
                } else {
                    res.render('login.ejs',{message: 'Invalid Password.'})
                }
            });
        } else {
            res.render('login.ejs',{message: 'User doesn\'t exists.'})
        }
    } catch(err) {
        console.log(err)
        res.render('login.ejs',{message: 'Something went wrong. Try again.'})
    }
})

app.get('/register',(req,res) => {
    if (req.session.user == undefined) {
        res.render('register.ejs')
    } else {
        res.redirect('/main/'+req.session.user)
    }
})

app.post('/register',async (req,res) => {
    try {
        let user_exist_data = await db.query('select * from users where username=$1;',[req.body.Username.trim()]);
        if (user_exist_data.rows.length>0) {
            res.render('register.ejs',{message: 'User already exists.'})
        } else {
            bcrypt.hash(req.body.Password, 10, async function(err, hash) {
                try {
                    // let department_ids = [];
                    let user_id_data = await db.query('insert into users(username,password,role,email) values($1,$2,$3,$4) RETURNING user_id;',[req.body.Username.trim(),hash,req.body.Role,req.body.Email]);
                    let user_id = user_id_data.rows[0].user_id;
                    if (req.body.Department) {
                        for (let i=0;i<req.body.Department.length;i++) {
                            let id_data = await db.query('select id from department where department=$1;',[req.body.Department[i]]);
                            await db.query('insert into user_department values($1,$2)',[user_id,id_data.rows[0].id]);
                        }
                    }
                    res.redirect('/login')
                } catch (err) {
                    res.render('register.ejs',{message: 'Something went wrong. Try again.'})
                    console.log(err)
                }
            });
        }
    } catch(err) {
        res.render('register.ejs',{message: 'Something went wrong. Try again.'})
        console.log(err)
    }
})

app.get('/main/:user_id',async (req,res) => {
    if (req.params.user_id == req.session.user) {
        let user_details = await db.query('select * from users where user_id=$1;',[req.params.user_id]);
        user_details = user_details.rows[0];
        if (user_details.role === 'Employee') {
            console.log(req.params.user_id)
            let grievances_open_data = await db.query('select * from grievance where emp_id=$1 and status=\'open\' order by grievance_post_datetime desc',[req.params.user_id]);
            res.render('employee_main.ejs',{data:grievances_open_data.rows,user_id:req.params.user_id});
        } else if (user_details.role === 'Administrator') {
            let grievance_data = await db.query('select * from grievance where status=\'open\' order by grievance_post_datetime desc;');
            let departments = [];
            let poster = [];
            for (let i=0;i<grievance_data.rows.length;i++) {
                let dept_id = grievance_data.rows[i].department_id;
                let department = await db.query('select department from department where id=$1;',[dept_id]);
                department = department.rows[0].department;
                departments.push(department);
                let poster_data = await db.query('select username from users where user_id=$1;',[grievance_data.rows[i].emp_id]);
                poster.push(poster_data.rows[0].username);
            }
            res.render('admin_main.ejs',{grievance_data:grievance_data.rows,message:'Open',user_id:req.params.user_id,sendtohrbutton:true,departments:departments,poster:poster});
        } else {
            let departments = await db.query('select department_id from user_department where user_id=$1;',[req.params.user_id]);
            departments = departments.rows;
            let data = [];
            for (let i=0;i<departments.length;i++) {
                let grievance_data = await db.query('select * from grievance where sent_to_department_id=$1 and status=\'sent to hr\';',[departments[i].department_id]);
                grievance_data = grievance_data.rows;
                data = [...data,...grievance_data];
            }
            let poster = [];
            for (let i=0;i<data.length;i++) {
                let emp_no = data[i].emp_id;
                let poster_data = await db.query('select username from users where user_id=$1;',[emp_no]);
                poster.push(poster_data.rows[0].username);
            }
            res.render('hr_main.ejs',{user_id:req.params.user_id,data:data,message:'Sent To HR',closedbutton:true,poster:poster});
        }
    } else {
        res.send('Unauthorised');
    }
    
})

app.post('/grievancePost/:user_id',async (req,res) => {
    try {
        let username_data = await db.query('select username from users where user_id=$1;',[req.params.user_id]);
        let username = username_data.rows[0].username;
        let department_data = await db.query('select id from department where department=$1;',[req.body.Department]);
        await db.query('insert into grievance(emp_id,grievance_title,grievance_desc,department_id,status,grievance_post_datetime) values($1,$2,$3,$4,\'open\',$5);',[req.params.user_id,req.body.Title,req.body.Description,department_data.rows[0].id,new Date()]);
        let admin_data = await db.query('select email from users where role=\'Administrator\';');
        admin_data = admin_data.rows;
        for (let i=0;i<admin_data.length;i++) {
            let mailOptions = {
                from:'smartyash334@gmail.com',
                to:admin_data[i].email,
                subject:'Got a grievance from '+username,
                text:'Grievance_title: '+req.body.Title
            }
            transporter.sendMail(mailOptions,(error,info)=> {
                if (error) {
                    console.log(error);
                } else {
                    console.log('Email sent successfully');
                }
            });
        }
        res.redirect('/main/'+req.params.user_id)
    } catch (err) {
        res.send('Something Went Wrong!')
    }
});

app.post('/selectPost/:user_id',async (req,res) => {
    let request = req.body.category.toLowerCase();
    let data = await db.query('select * from grievance where emp_id = $1 and status=\''+request+'\';',[req.params.user_id]);
    res.render('employee_main.ejs',{user_id:req.params.user_id,data:data.rows});
})

app.get('/grievance/:id/:user_id',async (req,res) => {
    let grievance_data = await db.query('select * from grievance where id=$1;',[req.params.id]);
    let comments_data = await db.query('select * from comments where grievance_id=$1 order by posted_on desc;',[req.params.id]);
    comments_data =comments_data.rows;
    let senders = [];
    for (let i=0;i<comments_data.length;i++) {
        let sender_data = await db.query('select username from users where user_id=$1;',[comments_data[i].sender]);
        senders.push(sender_data.rows[0].username);
    }
    res.render('grievance.ejs',{comments_data:comments_data,senders:senders,grievance_data:grievance_data.rows[0],grievance_id:req.params.id,user_id:req.params.user_id});
});

app.post('/postComment/:id/:user_id',async (req,res) => {
    await db.query('insert into comments(comment,sender,posted_on,grievance_id) values($1,$2,$3,$4);',[req.body.comment,req.params.user_id,new Date(),req.params.id]);
    res.redirect('/grievance/'+req.params.id+'/'+req.params.user_id);
})

app.post('/selectPostAdmin/:user_id',async(req,res) => {
    let request = req.body.category.toLowerCase();
    let data = await db.query('select * from grievance where status=\''+request+'\'order by grievance_post_datetime desc;');
    if (request == 'open') {
        let departments = [];
        let poster = [];
        for (let i=0;i<data.rows.length;i++) {
            let dept_id = data.rows[i].department_id;
            let emp_id = data.rows[i].emp_id;
            let department = await db.query('select department from department where id=$1;',[dept_id]);
            department = department.rows[0].department;
            let poster_data = await db.query('select username from users where user_id=$1;',[emp_id]);
            poster.push(poster_data.rows[0].username);
            departments.push(department);
        }
        res.render('admin_main.ejs',{grievance_data:data.rows,message:req.body.category,user_id:req.params.user_id,sendtohrbutton:true,departments:departments,poster:poster});
    } else {
        let departments = [];
        let poster = [];
        for (let i=0;i<data.rows.length;i++) {
            let dept_id = data.rows[i].sent_to_department_id;
            let emp_id = data.rows[i].emp_id;
            let department = await db.query('select department from department where id=$1;',[dept_id]);
            department = department.rows[0].department;
            let poster_data = await db.query('select username from users where user_id=$1;',[emp_id]);
            poster.push(poster_data.rows[0].username);
            departments.push(department);
        }
        res.render('admin_main.ejs',{grievance_data:data.rows,message:req.body.category,user_id:req.params.user_id,sendtohrbutton:false,departments:departments,poster:poster});
    }
})

app.get('/sendToHR/:id/:user_id',async (req,res) => {
    let dept_id = await db.query('select department_id from grievance where id=$1;',[req.params.id]);
    dept_id = dept_id.rows[0].department_id
    await db.query('update grievance set sent_to_department_id=$1,status=\'sent to hr\' where id=$1;',[req.params.id]);
    let hrs = await db.query('select user_id from user_department where department_id=$1;',[dept_id]);
    hrs = hrs.rows;
    let emp_data = await db.query('select emp_id from grievance where id=$1;',[req.params.id]);
    let employee_username = await db.query('select username from users where user_id=$1;',[emp_data.rows[0].emp_id]);
    employee_username = employee_username.rows[0].username;
    let grievance_data = await db.query('select grievance_title from grievance where id=$1;',[req.params.id]);
    grievance_data = grievance_data.rows[0].grievance_title;
    for (let i=0;i<hrs.length;i++) {
        let hr_id = hrs[i].user_id;
        let email = await db.query('select email from users where user_id=$1;',[hr_id])
        let mailOptions = {
            from:'smartyash334@gmail.com',
            to:email.rows[0].email,
            subject:'Got an grievance from '+employee_username,
            text:'Grievance Title: '+grievance_data
        }
        transporter.sendMail(mailOptions,(error,info)=> {
            if (error) {
                console.log(error);
            } else {
                console.log('Email sent successfully');
            }
        })
    }
    res.redirect('/main/'+req.params.user_id);
})

app.post('/sendToHR/:id/:user_id',async (req,res) => {
    let dept_id = await db.query('select id from department where department=$1;',[req.body.Department]);
    await db.query('update grievance set sent_to_department_id=$1,status=\'sent to hr\' where id=$2;',[dept_id.rows[0].id,req.params.id]);
    let hrs = await db.query('select user_id from user_department where department_id=$1;',[dept_id.rows[0].id]);
    hrs = hrs.rows;
    let emp_data = await db.query('select emp_id from grievance where id=$1;',[req.params.id]);
    let employee_username = await db.query('select username from users where user_id=$1;',[emp_data.rows[0].emp_id]);
    employee_username = employee_username.rows[0].username;
    let grievance_data = await db.query('select grievance_title from grievance where id=$1;',[req.params.id]);
    grievance_data = grievance_data.rows[0].grievance_title;
    for (let i=0;i<hrs.length;i++) {
        let hr_id = hrs[i].user_id;
        let email = await db.query('select email from users where user_id=$1;',[hr_id])
        let mailOptions = {
            from:'smartyash334@gmail.com',
            to:email.rows[0].email,
            subject:'Got an grievance from '+employee_username,
            text:'Grievance Title: '+grievance_data
        }
        transporter.sendMail(mailOptions,(error,info)=> {
            if (error) {
                console.log(error);
            } else {
                console.log('Email sent successfully');
            }
        })
    }
    res.redirect('/main/'+req.params.user_id);
})

app.post('/selectPostHR/:user_id',async (req,res) => {
    let request = req.body.category.toLowerCase();
    if (request !== 'open') {
        let departments = await db.query('select department_id from user_department where user_id=$1;',[req.params.user_id]);
        departments = departments.rows;
        let data = [];
        for (let i=0;i<departments.length;i++) {
            let grievance_data = await db.query('select * from grievance where sent_to_department_id=$1 and status=\''+request+'\';',[departments[i].department_id]);
            grievance_data = grievance_data.rows;
            data = [...data,...grievance_data];
        }
        let poster = [];
        for (let i=0;i<data.length;i++) {
            let emp_no = data[i].emp_id;
            let poster_data = await db.query('select username from users where user_id=$1;',[emp_no]);
            poster.push(poster_data.rows[0].username);
        }
        if (request == 'sent to hr') {
            res.render('hr_main.ejs',{user_id:req.params.user_id,data:data,message:'Sent To HR',closedbutton:true,poster:poster});
        } else {
            res.render('hr_main.ejs',{user_id:req.params.user_id,data:data,message:'Closed',closedbutton:false,poster:poster});
        }
    } else {
        let data = await db.query('select * from grievance where status=\'open\';')
        data = data.rows;
        let poster = [];
        for (let i=0;i<data.length;i++) {
            let emp_no = data[i].emp_id;
            let poster_data = await db.query('select username from users where user_id=$1;',[emp_no]);
            poster.push(poster_data.rows[0].username);
        }
        res.render('hr_main.ejs',{user_id:req.params.user_id,data:data,message:'Open',closedbutton:false,poster:poster});
    }
})

app.get('/close/:id/:user_id',async (req,res) => {
    await db.query('update grievance set status=\'closed\' where id=$1;',[req.params.id]);
    res.redirect('/main/'+req.params.user_id);
})

app.listen(3000,() => {
    console.log(`Connected on http://localhost:3000`)
})